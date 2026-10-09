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
