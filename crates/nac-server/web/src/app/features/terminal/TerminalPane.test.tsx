/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import { TerminalPane } from "./TerminalPane";
import type { UserTerminalFrameResponse } from "../../../../packages/nac-client/src/index";

const renderer = vi.hoisted(() => ({
  keyboard: undefined as undefined | ((data: string) => void),
  write: vi.fn(async (_bytes: Uint8Array, _signal: AbortSignal) => {}),
  reset: vi.fn(async () => {}),
  selection: vi.fn(() => "selected private output"),
  dispose: vi.fn(),
  options: { disableStdin: true },
}));
vi.mock("./xtermAdapter", () => ({
  createTerminalRenderer: async () => ({
    renderer: { write: renderer.write, reset: renderer.reset },
    terminal: {
      options: renderer.options,
      onData: (callback: (data: string) => void) => {
        renderer.keyboard = callback;
        return {
          dispose: () => {
            renderer.keyboard = undefined;
          },
        };
      },
      onBinary: () => ({ dispose: () => {} }),
      focus: vi.fn(),
      getSelection: renderer.selection,
    },
    fit: () => null,
    dispose: renderer.dispose,
  }),
}));

const terminal = {
  protocol_version: 1,
  terminal_id: "opaque-shell",
  cols: 80,
  rows: 24,
  alive: true,
  output_complete: false,
};
const clients: QueryClient[] = [];
function pending(signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) reject(signal.reason);
    else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
function fixture() {
  const api = {
    ...standaloneRuntime.api,
    listUserTerminals: vi.fn(async () => ({ protocol_version: 1, terminals: [terminal] })),
    getUserTerminal: vi.fn(async () => terminal),
    openUserTerminal: vi.fn(async () => terminal),
    attachUserTerminal: vi.fn(async () => ({
      protocol_version: 1,
      observer_id: "observer",
      idle_expiry_ms: 30_000,
      terminal,
    })),
    pullUserTerminal: vi.fn<typeof standaloneRuntime.api.pullUserTerminal>(
      async (_session, _id, _observer, _body, signal) => pending(signal),
    ),
    detachUserTerminal: vi.fn(async () => {}),
    inputUserTerminal: vi.fn<typeof standaloneRuntime.api.inputUserTerminal>(async () => {}),
    resizeUserTerminal: vi.fn(async () => {}),
    terminateTerminal: vi.fn(async () => {}),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const review = vi.fn();
  const runtime = { ...standaloneRuntime, api };
  const view = render(
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={client}>
        <TerminalPane sessionId="session" onReviewSelection={review} />
      </QueryClientProvider>
    </RuntimeContext.Provider>,
  );
  return { ...view, api, client, review };
}
beforeEach(() => {
  vi.clearAllMocks();
  renderer.options.disableStdin = true;
  renderer.write.mockImplementation(async () => {});
  renderer.selection.mockReturnValue("selected private output");
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

describe("terminal pane lifetime and explicit user actions", () => {
  it("waits for parsing before ACK, sends literal control input, and detaches without terminating", async () => {
    let parsed: () => void = () => {};
    renderer.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          parsed = resolve;
        }),
    );
    const f = fixture();
    const frame: UserTerminalFrameResponse = {
      protocol_version: 1,
      observer_id: "observer",
      terminal,
      bytes: [65],
      offset: "0",
      next_offset: "1",
      retained_start: "0",
      retained_end: "1",
      gap: false,
      caught_up: true,
      requires_ack: true,
    };
    f.api.pullUserTerminal.mockResolvedValueOnce(frame);
    await waitFor(() => expect(renderer.write).toHaveBeenCalledTimes(1));
    expect(f.api.pullUserTerminal).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer.keyboard?.("\u0003");
    });
    expect(f.api.inputUserTerminal.mock.calls[0]?.[2]).toEqual({ protocol_version: 1, bytes: [3] });
    await act(async () => parsed());
    await waitFor(() => expect(f.api.pullUserTerminal).toHaveBeenCalledTimes(2));
    expect(f.api.pullUserTerminal.mock.calls[1][3]).toMatchObject({ acknowledge_offset: "1" });
    f.unmount();
    expect(f.api.detachUserTerminal).toHaveBeenCalledWith(
      "session",
      "opaque-shell",
      "observer",
      undefined,
    );
    expect(f.api.terminateTerminal).not.toHaveBeenCalled();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not replay uncertain input and requires acknowledgement before fresh typing", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    f.api.inputUserTerminal.mockRejectedValueOnce(new Error("reply lost"));
    await act(async () => {
      renderer.keyboard?.("old command\r");
    });
    await screen.findByRole("button", { name: "Acknowledge failure and enable fresh input" });
    expect(f.api.inputUserTerminal).toHaveBeenCalledTimes(1);
    expect(renderer.options.disableStdin).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Acknowledge failure and enable fresh input" }),
    );
    await act(async () => {
      renderer.keyboard?.("new\r");
    });
    expect(f.api.inputUserTerminal).toHaveBeenCalledTimes(2);
    expect(f.api.inputUserTerminal.mock.calls[1]?.[2]).toEqual({
      protocol_version: 1,
      bytes: [110, 101, 119, 13],
    });
  });

  it("captures selection only on Review and keeps it out of query caches and DOM attributes", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    expect(f.review).not.toHaveBeenCalled();
    expect(renderer.selection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review selected text" }));
    expect(f.review).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session",
        terminalId: "opaque-shell",
        selectedText: "selected private output",
        sourceAlive: true,
      }),
    );
    expect(Object.isFrozen(f.review.mock.calls[0][0])).toBe(true);
    expect(
      JSON.stringify(
        f.client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data),
      ),
    ).not.toContain("selected private output");
    expect(f.container.innerHTML).not.toContain("selected private output");
  });

  it("explains an empty explicit selection without creating a draft", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    renderer.selection.mockReturnValueOnce("");
    fireEvent.click(screen.getByRole("button", { name: "Review selected text" }));
    await screen.findByText("Select text in the terminal before reviewing it.");
    expect(f.review).not.toHaveBeenCalled();
  });

  it("stops a failed observer and reconnects only when explicitly requested", async () => {
    const f = fixture();
    f.api.pullUserTerminal.mockRejectedValueOnce(new Error("observer expired"));
    await screen.findByText("Disconnected");
    expect(f.api.attachUserTerminal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(f.api.attachUserTerminal).toHaveBeenCalledTimes(2));
    expect(f.api.detachUserTerminal).toHaveBeenCalledTimes(1);
    expect(f.api.terminateTerminal).not.toHaveBeenCalled();
  });

  it("retries an unconfirmed launch with its original identity", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    f.api.openUserTerminal.mockRejectedValueOnce(new Error("launch reply lost"));
    fireEvent.click(screen.getByRole("button", { name: "New shell" }));
    await screen.findByRole("button", { name: "Retry opening same shell" });
    const first = f.api.openUserTerminal.mock.calls[0];
    fireEvent.click(screen.getByRole("button", { name: "Retry opening same shell" }));
    await waitFor(() => expect(f.api.openUserTerminal).toHaveBeenCalledTimes(2));
    expect(f.api.openUserTerminal.mock.calls[1]).toEqual(first);
  });
});
