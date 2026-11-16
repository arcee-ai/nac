/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNacClient } from "../../services/nacClient";
import { createNativeRuntime } from "../../runtime/nativeRuntime";
import { desktopReadFetch, installDesktopLifetime } from "./lifetime";
import type { DesktopCommandPort } from "./adapter";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("desktop document retirement and connection loss", () => {
  it("keeps ordinary browser lifetime and transport unchanged", () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(desktopReadFetch(undefined, fetch)).toBe(fetch);
    const runtime = { close: vi.fn() };
    const unmount = vi.fn();
    installDesktopLifetime(undefined, runtime, unmount, window)();
    expect(runtime.close).not.toHaveBeenCalled();
    expect(unmount).not.toHaveBeenCalled();
  });

  it("keeps successful engine reads and the live runtime through an offline hint", async () => {
    const pending = Promise.withResolvers<Response>();
    const report = vi.fn();
    const port: DesktopCommandPort = {
      connect: () => () => {},
      connectLifetime: () => () => {},
      reportConnectionLost: report,
    };
    const response = { messages: [] };
    const fetch = vi
      .fn<typeof globalThis.fetch>(async () => Response.json(response))
      .mockImplementationOnce(() => pending.promise);
    const runtime = createNativeRuntime({
      scope: {
        owner: "o",
        profile: "p",
        organization: "g",
        host: "h",
        incarnation: "i",
        endpoint: "/engine",
        release: "r",
      },
      client: createNacClient({ endpoint: "/engine", fetch: desktopReadFetch(port, fetch) }),
    });
    const close = vi.spyOn(runtime, "close");
    const unmount = vi.fn();
    closers.push(installDesktopLifetime(port, runtime, unmount, window));
    const read = runtime.api.getSession("same");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    window.dispatchEvent(new Event("offline"));
    pending.resolve(Response.json(response));
    await expect(read).resolves.toEqual(response);
    await expect(runtime.api.getSession("same")).resolves.toEqual(response);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(report).not.toHaveBeenCalled();
    expect(runtime.isClosed()).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(unmount).not.toHaveBeenCalled();
  });

  it("aborts the real runtime before unmount and disconnect, and fences late reads", async () => {
    const pending = Promise.withResolvers<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>(() => pending.promise);
    const runtime = createNativeRuntime({
      scope: {
        owner: "o",
        profile: "p",
        organization: "g",
        host: "h",
        incarnation: "i",
        endpoint: "/engine",
        release: "r",
      },
      client: createNacClient({ endpoint: "/engine", fetch }),
    });
    closers.push(() => runtime.close());
    const sequence: string[] = [];
    let dispose!: () => void;
    const connectionLost = vi.fn();
    const port: DesktopCommandPort = {
      connect: () => () => {},
      connectLifetime: (callback) => {
        dispose = callback;
        return () => sequence.push("disconnected");
      },
      reportConnectionLost: connectionLost,
    };
    const unmount = vi.fn(() => {
      expect(runtime.isClosed()).toBe(true);
      expect(runtime.queryClient.getQueryCache().getAll()).toHaveLength(0);
      sequence.push("unmounted");
    });
    closers.push(installDesktopLifetime(port, runtime, unmount, window));
    const read = runtime.api.getSession("same");
    const retired = expect(read).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    window.dispatchEvent(new Event("offline"));
    expect(connectionLost).not.toHaveBeenCalled();
    dispose();
    dispose();
    await retired;
    expect(sequence).toEqual(["unmounted", "disconnected"]);
    pending.resolve(Response.json({ messages: [] }));
    await Promise.resolve();
    window.dispatchEvent(new Event("offline"));
    expect(connectionLost).not.toHaveBeenCalled();
    expect(unmount).toHaveBeenCalledOnce();
  });

  it("lets the production !command client read back a dropped successful response before reporting a failed read", async () => {
    const lost = new TypeError("accepted response dropped");
    const report = vi.fn();
    const calls: string[] = [];
    const request = { request_id: "one", command: "printf fixture", timeout_ms: 1000 };
    const receipt = { ...request, operation_id: "op", state: "accepted" };
    const fetch = desktopReadFetch(
      { connect: () => () => {}, reportConnectionLost: report },
      async (_url, init) => {
        calls.push(init!.method!);
        if (init?.method === "POST") throw lost;
        expect(report).not.toHaveBeenCalled();
        return Response.json(receipt);
      },
    );
    const client = createNacClient({ endpoint: "/engine", fetch });
    expect(await client.submitShellCommand("session", request)).toEqual(receipt);
    expect(calls).toEqual(["POST", "GET"]);
    expect(report).not.toHaveBeenCalled();
    const offline = desktopReadFetch(
      { connect: () => () => {}, reportConnectionLost: report },
      async () => {
        throw lost;
      },
    );
    await expect(offline("/engine/sessions/session", { method: "GET" })).rejects.toBe(lost);
    expect(report).toHaveBeenCalledOnce();
  });

  it("does not classify canceled reads, definite HTTP errors or mutation loss as a reconnect command", async () => {
    const report = vi.fn();
    const failure = new TypeError("lost");
    const fetch = desktopReadFetch(
      { connect: () => () => {}, reportConnectionLost: report },
      async () => {
        throw failure;
      },
    );
    const controller = new AbortController();
    controller.abort();
    await expect(fetch("/engine/read", { signal: controller.signal })).rejects.toBe(failure);
    for (const method of ["POST", "PATCH", "DELETE"]) {
      await expect(fetch("/engine/mutate", { method })).rejects.toBe(failure);
    }
    const http = desktopReadFetch(
      { connect: () => () => {}, reportConnectionLost: report },
      async () => Response.json({}, { status: 503 }),
    );
    expect((await http("/engine/read")).status).toBe(503);
    expect(report).not.toHaveBeenCalled();
  });

  it("runs teardown even if one close stage throws and ignores later pagehide", () => {
    const steps: string[] = [];
    let dispose!: () => void;
    const port: DesktopCommandPort = {
      connect: () => () => {},
      connectLifetime: (close) => {
        dispose = close;
        return () => steps.push("disconnect");
      },
    };
    const close = installDesktopLifetime(
      port,
      {
        close: () => {
          steps.push("abort");
          throw new Error("disposer");
        },
      },
      () => steps.push("unmount"),
      window,
    );
    expect(dispose).toThrow("disposer");
    close();
    window.dispatchEvent(new Event("pagehide"));
    expect(steps).toEqual(["abort", "unmount", "disconnect"]);
  });
});
