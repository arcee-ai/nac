import { describe, expect, it, vi } from "vitest";
import { createNacApi } from "./api.js";
import { createNacClient } from "./nacClient.js";
import {
  UserTerminalConnection,
  TerminalInputUncertainError,
  TerminalProtocolError,
} from "./userTerminalConnection.js";
import type { UserTerminalFrameResponse, UserTerminalResponse } from "./types.js";

const terminal: UserTerminalResponse = {
  protocol_version: 1,
  terminal_id: "shell/id",
  cols: 80,
  rows: 24,
  alive: true,
  output_complete: false,
};
function frame(overrides: Partial<UserTerminalFrameResponse> = {}): UserTerminalFrameResponse {
  return {
    protocol_version: 1,
    observer_id: "observer/id",
    terminal,
    bytes: [27, 91, 49, 109, 240],
    offset: "0",
    next_offset: "5",
    retained_start: "0",
    retained_end: "5",
    gap: false,
    caught_up: true,
    requires_ack: true,
    ...overrides,
  };
}
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(frames: (UserTerminalFrameResponse | Error)[]) {
  const requests: {
    path: string;
    method: string;
    body: Record<string, unknown> | undefined;
    init: RequestInit | undefined;
  }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const path = String(input);
    requests.push({
      path,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      init,
    });
    if (path.endsWith("/observers"))
      return Response.json({
        protocol_version: 1,
        observer_id: "observer/id",
        idle_expiry_ms: 30_000,
        terminal,
      });
    if (path.endsWith("/read")) {
      const next = frames.shift();
      if (!next) throw new Error("No fixture frame");
      if (next instanceof Error) throw next;
      return Response.json(next);
    }
    return new Response(null, { status: 204 });
  });
  const api = createNacApi(
    createNacClient({
      endpoint: "https://example.test/nac/v1",
      credentials: "omit",
      authorization: { kind: "bearer", token: "token" },
      headers: { "X-Consumer": "immutable" },
      fetch,
    }),
  );
  const renderer = {
    reset: vi.fn(async () => {}),
    write: vi.fn(async (_bytes: Uint8Array, _signal: AbortSignal) => {}),
  };
  const connection = new UserTerminalConnection(api, "session/id", "shell/id", renderer);
  return { connection, api, renderer, fetch, requests };
}

describe("finite terminal observation", () => {
  it("uses consumer transport and waits for parser completion before ACK or another pull", async () => {
    const done = deferred();
    const f = fixture([
      frame(),
      frame({ bytes: [], offset: "5", next_offset: "5", requires_ack: false }),
    ]);
    await f.connection.attach();
    f.renderer.write.mockImplementationOnce(() => done.promise);
    const reading = f.connection.readNext();
    await vi.waitFor(() => expect(f.renderer.write).toHaveBeenCalledTimes(1));
    expect(f.requests.filter((r) => r.path.endsWith("/read"))).toHaveLength(1);
    await expect(f.connection.readNext()).rejects.toBeInstanceOf(TerminalProtocolError);
    expect(f.renderer.write.mock.calls[0][0]).toEqual(Uint8Array.from(frame().bytes));
    done.resolve();
    await reading;
    await f.connection.readNext();
    const reads = f.requests.filter((r) => r.path.endsWith("/read"));
    expect(reads[0].body).toEqual({ protocol_version: 1, acknowledge_reset: false, wait_ms: 1000 });
    expect(reads[1].body).toMatchObject({ acknowledge_offset: "5", acknowledge_reset: false });
    expect(reads[1].path).toBe(
      "https://example.test/nac/v1/sessions/session%2Fid/user-terminals/shell%2Fid/observers/observer%2Fid/read",
    );
    const headers = new Headers(reads[1].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("x-consumer")).toBe("immutable");
    expect(reads[1].init?.credentials).toBe("omit");
  });

  it("requires a renderer reset for gaps and preserves cursors beyond JS integer precision", async () => {
    const cursor = "9007199254740993";
    const reset = deferred();
    const f = fixture([
      frame({
        bytes: [],
        offset: cursor,
        next_offset: cursor,
        retained_start: cursor,
        retained_end: "9007199254740994",
        gap: true,
        caught_up: false,
      }),
      frame({
        bytes: [65],
        offset: cursor,
        next_offset: "9007199254740994",
        retained_start: cursor,
        retained_end: "9007199254740994",
      }),
    ]);
    await f.connection.attach();
    f.renderer.reset.mockImplementationOnce(() => reset.promise);
    const reading = f.connection.readNext();
    await vi.waitFor(() =>
      expect(f.renderer.reset).toHaveBeenCalledWith("gap", expect.any(AbortSignal)),
    );
    expect(f.renderer.write).not.toHaveBeenCalled();
    reset.resolve();
    await reading;
    await f.connection.readNext();
    expect(f.requests.at(-1)?.body).toMatchObject({
      acknowledge_offset: cursor,
      acknowledge_reset: true,
    });
  });

  it.each([
    { offset: "0" },
    { next_offset: "7" },
    { bytes: [65] },
    { requires_ack: false },
    { retained_start: "0", offset: "0", next_offset: "0" },
    { caught_up: true },
  ])("rejects malformed retention gaps before resetting: %j", async (invalid) => {
    const f = fixture([
      frame({
        bytes: [],
        offset: "8",
        next_offset: "8",
        retained_start: "8",
        retained_end: "9",
        gap: true,
        caught_up: false,
        ...invalid,
      }),
    ]);
    await f.connection.attach();
    await expect(f.connection.readNext()).rejects.toBeInstanceOf(TerminalProtocolError);
    expect(f.renderer.reset).toHaveBeenCalledTimes(1); // Only initial attachment.
    expect(f.renderer.write).not.toHaveBeenCalled();
  });

  it("resets again if retention advances while the preceding gap is acknowledged", async () => {
    const f = fixture([
      frame({
        bytes: [],
        offset: "8",
        next_offset: "8",
        retained_start: "8",
        retained_end: "9",
        gap: true,
        caught_up: false,
      }),
      frame({
        bytes: [],
        offset: "16",
        next_offset: "16",
        retained_start: "16",
        retained_end: "17",
        gap: true,
        caught_up: false,
      }),
      frame({
        bytes: [90],
        offset: "16",
        next_offset: "17",
        retained_start: "16",
        retained_end: "17",
      }),
    ]);
    await f.connection.attach();
    await f.connection.readNext();
    await f.connection.readNext();
    expect(f.requests.at(-1)?.body).toMatchObject({
      acknowledge_offset: "8",
      acknowledge_reset: true,
    });
    await f.connection.readNext();
    expect(f.requests.at(-1)?.body).toMatchObject({
      acknowledge_offset: "16",
      acknowledge_reset: true,
    });
    expect(f.renderer.reset).toHaveBeenCalledTimes(3);
    expect(f.renderer.write).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge a retention gap whose renderer reset failed", async () => {
    const f = fixture([
      frame({
        bytes: [],
        offset: "8",
        next_offset: "8",
        retained_start: "8",
        retained_end: "9",
        gap: true,
        caught_up: false,
      }),
    ]);
    await f.connection.attach();
    f.renderer.reset.mockRejectedValueOnce(new Error("reset failed"));
    await expect(f.connection.readNext()).rejects.toThrow("reset failed");
    await expect(f.connection.readNext()).rejects.toThrow("reconnect");
    expect(f.requests.at(-1)?.body).not.toHaveProperty("acknowledge_offset");
    expect(f.renderer.write).not.toHaveBeenCalled();
  });

  it("leaves the last applied ACK intact after a lost read response and never retries automatically", async () => {
    const f = fixture([
      frame(),
      new TypeError("lost ACK response"),
      frame({ bytes: [66], offset: "5", next_offset: "6", retained_end: "6" }),
    ]);
    await f.connection.attach();
    await f.connection.readNext();
    await expect(f.connection.readNext()).rejects.toThrow("lost ACK response");
    expect(f.fetch).toHaveBeenCalledTimes(3);
    await f.connection.readNext(); // Explicit caller resume, same idempotent ACK.
    expect(f.requests.at(-1)?.body).toMatchObject({ acknowledge_offset: "5" });
    expect(f.renderer.write).toHaveBeenCalledTimes(2);
  });

  it("cancels parser waits on detach, never ACKs a late callback, and explicitly resets on reconnect", async () => {
    const write = deferred();
    const f = fixture([frame(), frame()]);
    await f.connection.attach();
    f.renderer.write.mockImplementationOnce(() => write.promise);
    const reading = f.connection.readNext();
    const failed = expect(reading).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(f.renderer.write).toHaveBeenCalledTimes(1));
    await f.connection.detach();
    await failed;
    write.resolve();
    await f.connection.reconnect();
    await f.connection.readNext();
    expect(f.renderer.reset).toHaveBeenCalledWith("reconnect", expect.any(AbortSignal));
    expect(f.requests.at(-1)?.body).not.toHaveProperty("acknowledge_offset");
    expect(
      f.requests.filter((r) => r.method === "DELETE").every((r) => r.path.includes("/observers/")),
    ).toBe(true);
  });

  it("stops on expired observer without attaching or resetting until explicit reconnect", async () => {
    const f = fixture([new Error("observer expired")]);
    await f.connection.attach();
    await expect(f.connection.run()).rejects.toThrow("observer expired");
    expect(f.requests.filter((r) => r.path.endsWith("/observers"))).toHaveLength(1);
    expect(f.renderer.reset).toHaveBeenCalledTimes(1);
    await f.connection.reconnect();
    expect(f.requests.filter((r) => r.path.endsWith("/observers"))).toHaveLength(2);
  });

  it("ACKs the final parsed frame before declaring complete; process exit alone does not finish output", async () => {
    const exiting = { ...terminal, alive: false, exit_code: 0 };
    const complete = { ...exiting, output_complete: true };
    const f = fixture([
      frame({ terminal: exiting }),
      frame({ terminal: complete, bytes: [65], offset: "5", next_offset: "6", retained_end: "6" }),
      frame({
        terminal: complete,
        bytes: [],
        offset: "6",
        next_offset: "6",
        retained_end: "6",
        requires_ack: false,
      }),
    ]);
    await f.connection.attach();
    await expect(f.connection.run()).resolves.toEqual(complete);
    expect(f.requests.at(-1)?.body).toMatchObject({ acknowledge_offset: "6" });
    expect(f.renderer.write).toHaveBeenCalledTimes(2);
  });

  it("finishes output ACK while the process stays alive and requires independent cleanup status", async () => {
    const eofWhileAlive = { ...terminal, output_complete: true };
    const f = fixture([
      frame({ terminal: eofWhileAlive }),
      frame({
        terminal: eofWhileAlive,
        bytes: [],
        offset: "5",
        next_offset: "5",
        requires_ack: false,
      }),
    ]);
    await f.connection.attach();
    const outputStatus = await f.connection.run();
    expect(outputStatus).toEqual(eofWhileAlive);
    expect(outputStatus.alive).toBe(true);
    expect(outputStatus.exit_code).toBeUndefined();
    expect(f.requests.at(-1)?.body).toMatchObject({ acknowledge_offset: "5" });
    expect(f.renderer.write).toHaveBeenCalledTimes(1);
    expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(0);

    // The output loop neither detaches nor infers successful process cleanup.
    await f.connection.input(Uint8Array.of(65));
    expect(f.requests.at(-1)?.path).toMatch(/\/input$/);
    f.fetch.mockResolvedValueOnce(Response.json(eofWhileAlive));
    expect((await f.api.getUserTerminal("session/id", "shell/id")).alive).toBe(true);
    const exited = { ...eofWhileAlive, alive: false, exit_code: 0 };
    f.fetch.mockResolvedValueOnce(Response.json(exited));
    expect(await f.api.getUserTerminal("session/id", "shell/id")).toEqual(exited);
    expect(outputStatus).toEqual(eofWhileAlive); // The EOF result is a status snapshot.
    expect(f.fetch.mock.calls.slice(-2).every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it.each([
    { protocol_version: 2 },
    { observer_id: "other" },
    { terminal: { ...terminal, terminal_id: "other" } },
    { offset: "1" },
    { next_offset: "9007199254740994" },
    { bytes: [256] },
    { next_offset: "18446744073709551616" },
    { offset: "00" },
    { gap: true },
    { requires_ack: false },
    { caught_up: false },
  ])("rejects malformed/mismatched frame before rendering: %j", async (invalid) => {
    const f = fixture([frame(invalid)]);
    await f.connection.attach();
    await expect(f.connection.readNext()).rejects.toBeInstanceOf(TerminalProtocolError);
    expect(f.renderer.write).not.toHaveBeenCalled();
  });

  it("requires reset after partial renderer failure rather than replaying the same bytes into that parser", async () => {
    const f = fixture([frame()]);
    await f.connection.attach();
    f.renderer.write.mockRejectedValueOnce(new Error("parser failed"));
    await expect(f.connection.readNext()).rejects.toThrow("parser failed");
    await expect(f.connection.readNext()).rejects.toThrow("reconnect");
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("observer receipt cleanup", () => {
  it("releases each received post-attach cancellation before a four-seat quota can fill", async () => {
    const f = fixture([]);
    const seats = new Set<string>();
    let abort = new AbortController();
    let issued = 0;
    vi.spyOn(f.api, "attachUserTerminal").mockImplementation(async () => {
      if (seats.size >= 4) throw new Error("observer quota full");
      const observer = `received-${++issued}`;
      seats.add(observer);
      abort.abort(); // The decoded receipt is available despite a late local abort.
      return { protocol_version: 1, observer_id: observer, idle_expiry_ms: 30_000, terminal };
    });
    const detach = vi
      .spyOn(f.api, "detachUserTerminal")
      .mockImplementation(async (_session, _terminal, observer, signal) => {
        signal?.throwIfAborted();
        seats.delete(observer);
      });
    for (let index = 0; index < 6; index++) {
      abort = new AbortController();
      await expect(f.connection.attach(abort.signal)).rejects.toMatchObject({ name: "AbortError" });
      expect(seats.size).toBe(0);
      expect(f.connection.observerId).toBeUndefined();
    }
    expect(issued).toBe(6);
    expect(detach).toHaveBeenCalledTimes(6);
    expect(f.requests).toHaveLength(0); // No read, input or process termination.
  });

  it.each([{ protocol_version: 2 }, { terminal: { ...terminal, terminal_id: "other" } }])(
    "detaches a known receipt before rejecting its terminal/version and retains immutable routing: %j",
    async (invalid) => {
      const f = fixture([]);
      f.fetch.mockResolvedValueOnce(
        Response.json({ protocol_version: 1, observer_id: "received/id", terminal, ...invalid }),
      );
      await expect(f.connection.attach()).rejects.toBeInstanceOf(TerminalProtocolError);
      expect(f.connection.observerId).toBeUndefined();
      expect(f.requests).toHaveLength(1); // Mocked attachment bypassed the fixture recorder.
      const cleanup = f.requests[0];
      expect(cleanup.method).toBe("DELETE");
      expect(cleanup.path).toBe(
        "https://example.test/nac/v1/sessions/session%2Fid/user-terminals/shell%2Fid/observers/received%2Fid",
      );
      expect(cleanup.init?.signal).toBeUndefined();
      const headers = new Headers(cleanup.init?.headers);
      expect(headers.get("authorization")).toBe("Bearer token");
      expect(headers.get("x-consumer")).toBe("immutable");
      expect(cleanup.init?.credentials).toBe("omit");
    },
  );

  it("cleans a late receipt after detach and does not apply it to a new lifetime", async () => {
    const f = fixture([]);
    const arrived = deferred();
    const release = deferred();
    vi.spyOn(f.api, "attachUserTerminal").mockImplementationOnce(async () => {
      arrived.resolve();
      await release.promise;
      return { protocol_version: 1, observer_id: "late/id", idle_expiry_ms: 30_000, terminal };
    });
    const attach = f.connection.attach();
    const rejected = expect(attach).rejects.toMatchObject({ name: "AbortError" });
    await arrived.promise;
    await f.connection.detach();
    release.resolve();
    await rejected;
    expect(f.requests.map((request) => request.method)).toEqual(["DELETE"]);
    expect(f.requests[0].path).toMatch(/late%2Fid$/);
    expect(f.connection.observerId).toBeUndefined();
    await f.connection.attach();
    expect(f.connection.observerId).toBe("observer/id");
    await f.connection.detach();
  });

  it("retains failed cleanup receipts and clears them before accepting another observer", async () => {
    const f = fixture([]);
    const events: string[] = [];
    vi.spyOn(f.api, "attachUserTerminal").mockImplementation(async () => {
      events.push("attach");
      return { protocol_version: 2, observer_id: "retained/id", idle_expiry_ms: 30_000, terminal };
    });
    const detach = vi
      .spyOn(f.api, "detachUserTerminal")
      .mockRejectedValueOnce(new Error("cleanup response lost"))
      .mockImplementation(async () => {
        events.push("cleanup");
      });
    await expect(f.connection.attach()).rejects.toBeInstanceOf(TerminalProtocolError);
    expect(detach).toHaveBeenCalledTimes(1);
    await expect(f.connection.attach()).rejects.toBeInstanceOf(TerminalProtocolError);
    expect(events).toEqual(["attach", "cleanup", "attach", "cleanup"]);
    expect(detach).toHaveBeenCalledTimes(3);
  });

  it("does not invent a cleanup identity when the HTTP attachment receipt is lost", async () => {
    const f = fixture([]);
    f.fetch.mockRejectedValueOnce(new TypeError("attach receipt lost"));
    await expect(f.connection.attach()).rejects.toThrow("attach receipt lost");
    expect(f.connection.observerId).toBeUndefined();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(0);
    // No decoded identity was received: only the server's existing idle TTL can retire that seat.
  });

  it("a reconnect reset failure releases the old seat without creating a new one", async () => {
    const f = fixture([]);
    await f.connection.attach();
    f.renderer.reset.mockRejectedValueOnce(new Error("reset failed"));
    await expect(f.connection.reconnect()).rejects.toThrow("reset failed");
    expect(f.requests.filter((request) => request.path.endsWith("/observers"))).toHaveLength(1);
    expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
    expect(f.connection.observerId).toBeUndefined();
  });
});

describe("typed user terminal resource facade", () => {
  it("owns launch/list/status requests and keeps observation detach separate from process termination", async () => {
    const f = fixture([]);
    const abort = new AbortController();
    await f.api.openUserTerminal(
      "session/id",
      { protocol_version: 1, launch_id: "launch/id", cols: 91, rows: 31 },
      abort.signal,
    );
    await f.api.listUserTerminals("session/id", abort.signal);
    await f.api.getUserTerminal("session/id", "shell/id", abort.signal);
    await f.api.terminateTerminal("session/id", "shell/id");
    expect(f.requests.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "POST", path: "https://example.test/nac/v1/sessions/session%2Fid/user-terminals" },
      { method: "GET", path: "https://example.test/nac/v1/sessions/session%2Fid/user-terminals" },
      {
        method: "GET",
        path: "https://example.test/nac/v1/sessions/session%2Fid/user-terminals/shell%2Fid",
      },
      {
        method: "DELETE",
        path: "https://example.test/nac/v1/sessions/session%2Fid/terminals/shell%2Fid",
      },
    ]);
    expect(f.requests[0].body).toEqual({
      protocol_version: 1,
      launch_id: "launch/id",
      cols: 91,
      rows: 31,
    });
    expect(f.requests.slice(0, 3).every(({ init }) => init?.signal === abort.signal)).toBe(true);
  });
});

describe("literal terminal mutation", () => {
  it("sends raw bytes once, freezes input after uncertainty, and never retries on reconnect", async () => {
    const f = fixture([]);
    f.fetch.mockRejectedValueOnce(new TypeError("lost input receipt"));
    const bytes = Uint8Array.of(3, 0, 27, 91, 50, 48, 48, 126, 240);
    await expect(f.connection.input(bytes)).rejects.toBeInstanceOf(TerminalInputUncertainError);
    await expect(f.connection.input(bytes)).rejects.toBeInstanceOf(TerminalInputUncertainError);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    await f.connection.reconnect();
    expect(f.connection.isInputUncertain).toBe(true);
    f.connection.acknowledgeInputUncertainty();
    await f.connection.input(Uint8Array.of(65));
    expect(f.requests.at(-1)?.body).toEqual({ protocol_version: 1, bytes: [65] });
  });

  it("rejects an in-flight or oversized input instead of creating an unbounded queue", async () => {
    const f = fixture([]);
    const pending = deferred();
    f.fetch.mockImplementationOnce(async () => {
      await pending.promise;
      return new Response(null, { status: 204 });
    });
    const first = f.connection.input(Uint8Array.of(65));
    await expect(f.connection.input(Uint8Array.of(66))).rejects.toThrow("not queued");
    await expect(f.connection.input(new Uint8Array(16_385))).rejects.toThrow("length");
    expect(f.fetch).toHaveBeenCalledTimes(1);
    pending.resolve();
    await first;
  });

  it("binds resize to observation lifetime so detach cancels an outstanding resize", async () => {
    const f = fixture([]);
    await f.connection.attach();
    let resizeSignal: AbortSignal | null | undefined;
    const started = deferred();
    f.fetch.mockImplementationOnce(async (_input, init) => {
      resizeSignal = init?.signal;
      started.resolve();
      return new Promise<Response>((_resolve, reject) => {
        resizeSignal?.addEventListener("abort", () => reject(resizeSignal?.reason), { once: true });
      });
    });
    const resize = f.connection.resize(91, 31);
    const rejected = expect(resize).rejects.toMatchObject({ name: "AbortError" });
    await started.promise;
    expect(resizeSignal?.aborted).toBe(false);
    await f.connection.detach();
    await rejected;
    expect(resizeSignal?.aborted).toBe(true);
  });

  it("does not send pre-aborted input or invalid geometry and forwards real dimensions", async () => {
    const f = fixture([]);
    const abort = new AbortController();
    abort.abort();
    await expect(f.connection.input(Uint8Array.of(65), abort.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(f.connection.isInputUncertain).toBe(false);
    await expect(f.connection.resize(1, 24)).rejects.toThrow("columns");
    expect(f.fetch).not.toHaveBeenCalled();
    await f.connection.resize(91, 31);
    expect(f.requests.at(-1)?.body).toEqual({ protocol_version: 1, cols: 91, rows: 31 });
  });
});
