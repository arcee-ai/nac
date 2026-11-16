/** @vitest-environment jsdom */
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNacClient } from "../services/nacClient";
import { ExecutionDetail } from "../features/terminal/TerminalDetail";
import { executionHeading } from "../features/terminal/terminalLabels";
import type { ExecutionStatus } from "../../../packages/nac-client/src/index";
import { NativePresentationRoot } from "./NativePresentationRoot";
import { createNativeRuntime, type NativeRuntimeOptions } from "./nativeRuntime";

// Only HTTP and xterm are doubles. The SDK, pump, trusted-event input gate,
// controller, control query/mutation, acknowledgement UI and runtime are real.
// This is document-owner characterization, not WK/OS crash acceptance.
const renderer = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../features/terminal/xtermAdapter", () => ({ createTerminalRenderer: renderer.create }));
const opened: ReturnType<typeof createNativeRuntime>[] = [];
const binding = {
  owner: "local",
  profile: "fixture",
  organization: "local",
  host: "bundled",
  incarnation: "same-serving-engine",
  endpoint: "/engine",
  release: "fixture",
};
const source: ExecutionStatus = {
  id: "engine:opaque-execution",
  origin: "human",
  representation: "pty",
  backend: "local",
  cwd: "/fixture",
  alive: true,
  process_state: "running",
  input: true,
  resize: true,
  stop: true,
  retained: true,
  output_complete: false,
  cols: 80,
  rows: 24,
};
function view() {
  const textarea = document.createElement("textarea");
  let keyboard: ((event: { key: string; domEvent: KeyboardEvent }) => void) | undefined;
  const adapter = {
    terminal: {
      options: { disableStdin: true },
      textarea,
      onKey(callback: typeof keyboard) {
        keyboard = callback;
        return {
          dispose() {
            keyboard = undefined;
          },
        };
      },
      onData: () => ({ dispose() {} }),
      onBinary: () => ({ dispose() {} }),
      focus: () => textarea.focus(),
      getSelection: () => "",
    },
    renderer: { reset: vi.fn(async () => {}), write: vi.fn(async () => {}) },
    fit: () => null,
    dispose: vi.fn(() => textarea.remove()),
  };
  return {
    adapter,
    // Exercise the production event callback with an explicitly labeled trusted
    // keyboard double; never invoke controls.pump.send to bypass its input gate.
    type(key: string) {
      textarea.focus();
      keyboard?.({ key, domEvent: { isTrusted: true } as KeyboardEvent });
    },
    captureKey: () => keyboard,
  };
}
beforeEach(() => {
  renderer.create.mockReset();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
});
afterEach(() => {
  cleanup();
  for (const runtime of opened.splice(0)) runtime.close();
  vi.unstubAllGlobals();
});

it("requires acknowledgement after same-engine document replacement even when a committed write leaves canonical control unfrozen", async () => {
  const dropped = Promise.withResolvers<Response>();
  const written: string[] = [];
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  let revision = "1";
  let observer = 0;
  const control = () => ({
    protocol_version: 1,
    controller: "human",
    revision,
    in_flight: false,
    frozen: false,
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const path = new URL(String(url), "http://fixture.invalid").pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ path, method, body });
    if (path.endsWith("/input-control")) {
      if (method === "POST") {
        expect(body).toEqual({
          protocol_version: 1,
          expected_revision: "1",
          controller: "human",
          acknowledge_uncertainty: true,
        });
        revision = "2";
      }
      return Response.json(control());
    }
    if (path.endsWith("/input")) {
      expect(body.expected_revision).toBe(revision);
      // The fake server has completed write+flush (Written), without freezing
      // control, before the HTTP success receipt is deliberately lost.
      written.push(new TextDecoder().decode(Uint8Array.from(body.bytes)));
      if (written.length === 1) return dropped.promise;
      return Response.json({ outcome: "written", error: null });
    }
    if (path.endsWith("/observers"))
      return Response.json({
        protocol_version: 1,
        observer_id: `observer-${++observer}`,
        idle_expiry_ms: 30000,
        terminal: { ...source, protocol_version: 1, terminal_id: source.id },
      });
    if (path.endsWith("/read"))
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    if (method === "DELETE") return new Response(null, { status: 204 });
    throw new Error(`Unexpected fixture request ${method} ${path}`);
  });
  function runtime(requireTerminalAcknowledgement = false) {
    // The intersection allows the frozen test to run on the pre-repair base,
    // which ignores the proposed option rather than failing on missing syntax.
    const options: NativeRuntimeOptions & { requireTerminalAcknowledgement: boolean } = {
      scope: binding,
      client: createNacClient({ endpoint: binding.endpoint, fetch }),
      requireTerminalAcknowledgement,
    };
    const runtime = createNativeRuntime(options);
    opened.push(runtime);
    return runtime;
  }
  function mount(runtime: ReturnType<typeof createNativeRuntime>) {
    const next = view();
    renderer.create.mockImplementationOnce(async (host: HTMLElement) => {
      host.append(next.adapter.terminal.textarea);
      return next.adapter;
    });
    const mounted = render(
      createElement(NativePresentationRoot, {
        runtime,
        router: () =>
          createElement(ExecutionDetail, {
            sessionId: "session",
            source,
            heading: executionHeading(source, "Shell"),
            menuSlot: null,
          }),
      }),
    );
    return { ...next, mounted };
  }
  const first = runtime();
  const old = mount(first);
  await vi.waitFor(() => expect(old.adapter.terminal.options.disableStdin).toBe(false));
  const lateKey = old.captureKey();
  old.type("A");
  await vi.waitFor(() => expect(written).toEqual(["A"]));
  old.type("B"); // Queued behind the server-committed A whose HTTP receipt is pending.
  await act(async () => {
    first.close();
  });
  old.mounted.unmount();
  expect(old.adapter.dispose).toHaveBeenCalledOnce();
  expect(written).toEqual(["A"]); // Closing discards queued B, never retries A.

  const next = runtime(true); // Native supplies this fact even if dead JS never acknowledges retirement.
  expect(next.scope).toEqual(first.scope);
  expect(next.id).not.toBe(first.id);
  const recovered = mount(next);
  await vi.waitFor(() => expect(observer).toBe(2));
  expect(await next.api.getTerminalInputControl("session", source.id)).toMatchObject({
    controller: "human",
    revision: "1",
    in_flight: false,
    frozen: false,
  });
  expect(recovered.adapter.terminal.options.disableStdin).toBe(true);
  const acknowledge = screen.getByRole("button", {
    name: "Acknowledge failure and enable fresh input",
  });
  recovered.type("C");
  expect(written).toEqual(["A"]);
  expect(
    requests.filter((row) => row.path.endsWith("/input-control") && row.method === "POST"),
  ).toHaveLength(0);

  // The retired request's lost receipt and a stale trusted callback cannot
  // clear the replacement fence, transmit B, or contribute fresh input.
  await act(async () => {
    dropped.reject(new TypeError("Written receipt lost after commit"));
    await Promise.resolve();
  });
  lateKey?.({ key: "B", domEvent: { isTrusted: true } as KeyboardEvent });
  expect(next.terminalInputRecovery.acquire("session", source.id).current).toBe(true);
  expect(recovered.adapter.terminal.options.disableStdin).toBe(true);
  expect(written).toEqual(["A"]);
  fireEvent.click(acknowledge);
  await vi.waitFor(() => expect(recovered.adapter.terminal.options.disableStdin).toBe(false));
  expect(
    requests.filter((row) => row.path.endsWith("/input-control") && row.method === "POST"),
  ).toHaveLength(1);
  recovered.type("C");
  await vi.waitFor(() => expect(written).toEqual(["A", "C"]));
  expect(requests.filter((row) => row.path.endsWith("/input")).map((row) => row.body)).toEqual([
    { protocol_version: 1, expected_revision: "1", bytes: [65] },
    { protocol_version: 1, expected_revision: "2", bytes: [67] },
  ]);
});
