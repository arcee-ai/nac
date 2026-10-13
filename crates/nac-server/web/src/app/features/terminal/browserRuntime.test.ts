/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement, StrictMode, useRef } from "react";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import { openTerminalObservation } from "./browserRuntime";
import { useTerminalController } from "./useTerminalController";

const factory = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./xtermAdapter", () => ({ createTerminalRenderer: factory.create }));
const status = {
  protocol_version: 1,
  terminal_id: "terminal",
  cols: 80,
  rows: 24,
  alive: true,
  output_complete: false,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function adapter() {
  return {
    terminal: {
      options: { disableStdin: true },
      textarea: document.createElement("textarea"),
      onKey: vi.fn(() => ({ dispose: vi.fn() })),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onBinary: vi.fn(() => ({ dispose: vi.fn() })),
    },
    renderer: { reset: vi.fn(async () => {}), write: vi.fn(async () => {}) },
    fit: vi.fn<() => { cols: number; rows: number } | null>(() => null),
    dispose: vi.fn(),
  };
}
const closers: Array<() => void> = [];
function fixture() {
  const view = adapter();
  factory.create.mockResolvedValueOnce(view);
  const api = {
    ...standaloneRuntime.api,
    attachUserTerminal: vi.fn(async () => ({
      protocol_version: 1,
      observer_id: "observer",
      idle_expiry_ms: 30_000,
      terminal: status,
    })),
    pullUserTerminal: vi.fn<typeof standaloneRuntime.api.pullUserTerminal>(
      (_session, _terminal, _observer, _body, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    ),
    resizeUserTerminal: vi.fn<typeof standaloneRuntime.api.resizeUserTerminal>(async () => {}),
    detachUserTerminal: vi.fn(async () => {}),
    terminateTerminal: vi.fn(async () => {}),
  };
  const ports = {
    api,
    sessionId: "session",
    terminalId: "terminal",
    host: document.createElement("div"),
    reconnect: false,
    previousFailure: { current: false },
    controls: vi.fn(),
    phase: vi.fn(),
    notice: vi.fn(),
    inputFailure: vi.fn(),
  };
  const open = () => {
    const close = openTerminalObservation(ports);
    closers.push(close);
    return close;
  };
  return { api, ports, view, open };
}
let resized: () => void;
const disconnect = vi.fn();
beforeEach(() => {
  factory.create.mockReset();
  disconnect.mockReset();
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {
        disconnect();
      }
    },
  );
});
afterEach(() => {
  cleanup();
  for (const close of closers.splice(0)) close();
  vi.unstubAllGlobals();
});

describe("scoped terminal observation", () => {
  it("keeps StrictMode's abandoned renderer separate from the live activation", async () => {
    const f = fixture();
    const late = deferred<ReturnType<typeof adapter>>();
    factory.create.mockReset().mockReturnValueOnce(late.promise).mockResolvedValueOnce(f.view);
    function Bridge() {
      const host = useRef<HTMLDivElement | null>(null);
      useTerminalController("session", "terminal", host);
      return createElement("div", { ref: host });
    }
    const rendered = render(
      createElement(
        StrictMode,
        null,
        createElement(
          RuntimeContext.Provider,
          { value: { ...standaloneRuntime, api: f.api } },
          createElement(Bridge),
        ),
      ),
    );
    await vi.waitFor(() => expect(f.api.pullUserTerminal).toHaveBeenCalledOnce());
    const abandoned = adapter();
    late.resolve(abandoned);
    await vi.waitFor(() => expect(abandoned.dispose).toHaveBeenCalledOnce());
    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(f.api.attachUserTerminal).toHaveBeenCalledOnce();
    expect(f.view.dispose).not.toHaveBeenCalled();
    rendered.unmount();
    expect(f.view.dispose).toHaveBeenCalledOnce();
    expect(f.api.terminateTerminal).not.toHaveBeenCalled();
  });

  it("releases a renderer acquired after cleanup without attaching or painting", async () => {
    const f = fixture();
    const acquisition = deferred<ReturnType<typeof adapter>>();
    factory.create.mockReset().mockReturnValueOnce(acquisition.promise);
    const close = f.open();
    close();
    acquisition.resolve(f.view);
    await vi.waitFor(() => expect(f.view.dispose).toHaveBeenCalledTimes(1));
    expect(f.api.attachUserTerminal).not.toHaveBeenCalled();
    expect(f.ports.controls).not.toHaveBeenCalled();
    expect(f.ports.phase).not.toHaveBeenCalled();
  });

  it("finishes synchronous disposal before replacement activation acquires resources", async () => {
    const f = fixture();
    const close = f.open();
    await vi.waitFor(() => expect(f.api.pullUserTerminal).toHaveBeenCalledOnce());
    close();
    close();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(f.view.terminal.onData.mock.results[0].value.dispose).toHaveBeenCalledOnce();
    expect(f.view.terminal.onBinary.mock.results[0].value.dispose).toHaveBeenCalledOnce();
    expect(f.view.dispose).toHaveBeenCalledOnce();
    expect(f.ports.controls).toHaveBeenLastCalledWith(null);
    const next = adapter();
    factory.create.mockImplementationOnce(async () => {
      expect(f.view.dispose).toHaveBeenCalledOnce();
      return next;
    });
    f.open();
    await vi.waitFor(() => expect(f.api.attachUserTerminal).toHaveBeenCalledTimes(2));
    expect(f.api.terminateTerminal).not.toHaveBeenCalled();
  });

  it("cleans a late attach receipt through the SDK without releasing the shell", async () => {
    const f = fixture();
    const attach = deferred<Awaited<ReturnType<typeof f.api.attachUserTerminal>>>();
    f.api.attachUserTerminal.mockReturnValueOnce(attach.promise);
    const close = f.open();
    await vi.waitFor(() => expect(f.api.attachUserTerminal).toHaveBeenCalledOnce());
    close();
    attach.resolve({
      protocol_version: 1,
      observer_id: "late-observer",
      idle_expiry_ms: 30000,
      terminal: status,
    });
    await vi.waitFor(() =>
      expect(f.api.detachUserTerminal).toHaveBeenCalledWith(
        "session",
        "terminal",
        "late-observer",
        undefined,
      ),
    );
    expect(f.api.pullUserTerminal).not.toHaveBeenCalled();
    expect(f.ports.phase).not.toHaveBeenCalledWith("Connected");
    expect(f.view.dispose).toHaveBeenCalledOnce();
    expect(f.api.terminateTerminal).not.toHaveBeenCalled();
  });

  it("owns partially acquired browser handles when observer initialization fails", async () => {
    const f = fixture();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {
          throw new Error("observer unavailable");
        }
        disconnect() {
          disconnect();
        }
      },
    );
    const close = f.open();
    await vi.waitFor(() => expect(f.ports.phase).toHaveBeenCalledWith("Disconnected"));
    close();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(f.view.dispose).toHaveBeenCalledOnce();
    expect(f.view.terminal.onData.mock.results[0].value.dispose).toHaveBeenCalledOnce();
    expect(f.api.attachUserTerminal).not.toHaveBeenCalled();
  });

  it("coalesces geometry during a pending resize without parallel process control", async () => {
    const f = fixture();
    const first = deferred<void>();
    f.view.fit.mockReturnValueOnce({ cols: 81, rows: 25 });
    f.api.resizeUserTerminal.mockReturnValueOnce(first.promise);
    f.open();
    await vi.waitFor(() => expect(f.api.resizeUserTerminal).toHaveBeenCalledOnce());
    f.view.fit.mockReturnValueOnce({ cols: 90, rows: 30 });
    resized();
    f.view.fit.mockReturnValueOnce({ cols: 100, rows: 40 });
    resized();
    expect(f.api.resizeUserTerminal).toHaveBeenCalledOnce();
    first.resolve();
    await vi.waitFor(() => expect(f.api.resizeUserTerminal).toHaveBeenCalledTimes(2));
    expect(f.api.resizeUserTerminal.mock.calls[1][2]).toEqual({
      protocol_version: 1,
      cols: 100,
      rows: 40,
    });
    await vi.waitFor(() => expect(f.api.pullUserTerminal).toHaveBeenCalledOnce());
  });
});
