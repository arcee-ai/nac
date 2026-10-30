/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import type { ExecutionHistoryEntry } from "../../../../packages/nac-client/src/types";
import { TerminalWorkspace } from "./TerminalWorkspace";

const observation = vi.hoisted(() => ({ capture: vi.fn(), stdin: { disableStdin: true } }));
vi.mock("@/app/features/terminal/xtermAdapter", () => ({
  createTerminalRenderer: async (host: HTMLElement) => {
    const textarea = document.createElement("textarea");
    host.append(textarea);
    const disposable = { dispose: () => {} };
    return {
      renderer: { write: async () => {}, reset: async () => {} },
      terminal: {
        options: observation.stdin,
        textarea,
        resize: () => {},
        onKey: () => disposable,
        onData: () => disposable,
        onBinary: () => disposable,
        focus: () => textarea.focus(),
        getSelection: () => "",
      },
      fit: () => null,
      dispose: () => {},
    };
  },
}));
vi.mock("./useSelectionReview", () => ({
  useSelectionReview: () => ({ controller: { capture: observation.capture }, state: {} }),
}));

const clients: QueryClient[] = [];
beforeEach(() => {
  observation.stdin.disableStdin = true;
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  // No breakpoint matches, so the pane lays out for a desktop.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
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
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("opens recent activity in the pane read-only without a recovering session snapshot read", async () => {
  const entry: ExecutionHistoryEntry = {
    id: "human-source",
    started_at_epoch_ms: "1000",
    outcome: null,
    command: null,
    execution: {
      id: "human-source",
      origin: "human",
      representation: "pty",
      cwd: "/workspace",
      backend: "local",
      alive: true,
      process_state: "running",
      output_complete: false,
      input: true,
      resize: true,
      stop: true,
      retained: true,
      cols: 80,
      rows: 24,
    },
    output: { availability: "retained", retained_start: "0", retained_end: "10" },
  };
  const api = {
    ...standaloneRuntime.api,
    getSession: vi.fn(async () => {
      throw new Error("A history view must not fetch the recovering snapshot");
    }),
    listExecutions: vi.fn(async () => ({ protocol_version: 1, executions: [] })),
    listExecutionHistory: vi.fn(async () => ({
      protocol_version: 1,
      history: { entries: [entry], limit: 32, older_entries_omitted: false },
    })),
    attachExecution: vi.fn<typeof standaloneRuntime.api.attachExecution>(async (_session, id) => ({
      protocol_version: 1,
      observer_id: "observer",
      idle_expiry_ms: 30_000,
      terminal: {
        protocol_version: 1,
        terminal_id: id,
        cols: 80,
        rows: 24,
        alive: true,
        output_complete: false,
      },
    })),
    pullExecution: vi.fn<typeof standaloneRuntime.api.pullExecution>(
      async (_session, _id, _observer, _body, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    ),
    detachExecution: vi.fn(async () => {}),
    getTerminalInputControl: vi.fn(),
    transferTerminalInputControl: vi.fn(),
    inputControlledTerminal: vi.fn(),
    openUserTerminal: vi.fn(),
    inputUserTerminal: vi.fn(),
    resizeUserTerminal: vi.fn(),
    stopExecution: vi.fn(),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <RuntimeContext.Provider value={{ ...standaloneRuntime, api }}>
      <QueryClientProvider client={client}>
        <TerminalWorkspace sessionId="session" />
      </QueryClientProvider>
    </RuntimeContext.Provider>,
  );
  const recent = screen.getByRole("region", { name: "Recent terminal activity" });
  fireEvent.click(await within(recent).findByRole("button", { name: /^Shell · .*, Running$/ }));
  await waitFor(() => expect(api.attachExecution).toHaveBeenCalledOnce());
  expect(api.attachExecution.mock.calls[0][1]).toBe("human-source");
  // The entry's live capabilities stay with the live row; history only observes.
  expect(screen.queryByLabelText("Terminal input ownership")).toBeNull();
  expect(within(recent).getAllByRole("button")).toHaveLength(1);
  expect(observation.stdin.disableStdin).toBe(true);
  expect(api.getSession).not.toHaveBeenCalled();
  expect(observation.capture).not.toHaveBeenCalled();
  expect(api.getTerminalInputControl).not.toHaveBeenCalled();
  expect(api.openUserTerminal).not.toHaveBeenCalled();
  expect(api.inputUserTerminal).not.toHaveBeenCalled();
  expect(api.resizeUserTerminal).not.toHaveBeenCalled();
  expect(api.stopExecution).not.toHaveBeenCalled();
});
