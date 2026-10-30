/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import type { ExecutionHistoryEntry } from "../../../../packages/nac-client/src/types";
import { TerminalPane } from "./TerminalPane";
import { executionHistoryKey } from "./historyQueries";

vi.mock("./xtermAdapter", () => ({
  createTerminalRenderer: async (host: HTMLElement) => {
    const textarea = document.createElement("textarea");
    host.append(textarea);
    const disposable = { dispose: () => {} };
    return {
      renderer: { write: async () => {}, reset: async () => {} },
      terminal: {
        options: { disableStdin: true },
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

const entry: ExecutionHistoryEntry = {
  id: "human",
  started_at_epoch_ms: "1000",
  outcome: null,
  command: null,
  execution: {
    id: "opaque-shell",
    origin: "human",
    representation: "pty",
    cwd: "/workspace",
    backend: "local",
    alive: false,
    process_state: "settled",
    exit_code: 0,
    output_complete: true,
    input: false,
    resize: false,
    stop: false,
    retained: false,
    cols: 80,
    rows: 24,
  },
  output: { availability: "retained", retained_start: "0", retained_end: "10" },
};
const clients: QueryClient[] = [];
beforeEach(() => {
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
  vi.unstubAllGlobals();
});

function pending(signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) reject(signal.reason);
    else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

function fixture(entries = [entry]) {
  const response = (items: ExecutionHistoryEntry[]) => ({
    protocol_version: 1,
    history: { entries: items, limit: 32, older_entries_omitted: false },
  });
  const api = {
    ...standaloneRuntime.api,
    listExecutions: vi.fn(async () => ({ protocol_version: 1, executions: [] })),
    listExecutionHistory: vi.fn(async () => response(entries)),
    attachExecution: vi.fn<typeof standaloneRuntime.api.attachExecution>(async (_session, id) => ({
      protocol_version: 1,
      observer_id: "observer",
      idle_expiry_ms: 30_000,
      terminal: {
        protocol_version: 1,
        terminal_id: id,
        cols: 80,
        rows: 24,
        alive: false,
        output_complete: true,
      },
    })),
    pullExecution: vi.fn<typeof standaloneRuntime.api.pullExecution>(
      async (_session, _id, _observer, _body, signal) => pending(signal),
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const view = render(
    <RuntimeContext.Provider value={{ ...standaloneRuntime, api }}>
      <QueryClientProvider client={client}>
        <TerminalPane sessionId="session" />
      </QueryClientProvider>
    </RuntimeContext.Provider>,
  );
  const open = async () => {
    const recent = screen.getByRole("region", { name: "Recent terminal activity" });
    fireEvent.click(await within(recent).findByRole("button"));
  };
  return { ...view, api, client, response, open };
}

function expectNoProcessAction(api: ReturnType<typeof fixture>["api"]) {
  for (const operation of [
    api.openUserTerminal,
    api.inputUserTerminal,
    api.inputControlledTerminal,
    api.transferTerminalInputControl,
    api.resizeUserTerminal,
    api.stopExecution,
  ])
    expect(operation).not.toHaveBeenCalled();
}

describe("recent terminal activity", () => {
  it("lists entries as rows and replays retained output read-only on open", async () => {
    const f = fixture();
    const recent = screen.getByRole("region", { name: "Recent terminal activity" });
    const row = await within(recent).findByRole("button", {
      name: /^Shell · .*, Settled · exit 0$/,
    });
    expect(f.api.attachExecution).not.toHaveBeenCalled();
    fireEvent.click(row);
    await waitFor(() => expect(f.api.attachExecution).toHaveBeenCalledOnce());
    expect(f.api.attachExecution.mock.calls[0][1]).toBe("opaque-shell");
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByText(
        "Human shell · Settled · exit 0 · local · /workspace · collection complete · Read-only",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Terminal input ownership")).toBeNull();
    expectNoProcessAction(f.api);
  });

  it("falls back to the record when the open entry's output expires, without a new observer", async () => {
    const f = fixture();
    await f.open();
    await waitFor(() => expect(f.api.attachExecution).toHaveBeenCalledOnce());
    f.api.listExecutionHistory.mockResolvedValue(
      f.response([{ ...entry, output: { availability: "expired" } }]),
    );
    await act(async () => {
      await f.client.invalidateQueries({ queryKey: executionHistoryKey("session") });
    });
    await screen.findByText(/^Output expired\. The recorded outcome remains available\./);
    expect(screen.getByRole("article", { name: "Recorded terminal activity" })).toBeTruthy();
    await waitFor(() => expect(f.api.detachExecution).toHaveBeenCalledOnce());
    expect(f.api.attachExecution).toHaveBeenCalledOnce();
    expectNoProcessAction(f.api);
  });

  it("shows literal canonical previews and loss separately from known results", async () => {
    const command = {
      request_id: "request",
      operation_id: "operation",
      command: "printf known",
      timeout_ms: 30000,
      state: "completed" as const,
      accepted_at_epoch_ms: 1000,
      exit_code: 7,
      stdout: "<img src=x onerror=alert(1)>known",
      stderr: "",
    };
    const f = fixture([
      {
        ...entry,
        id: "command-request",
        command,
        execution: null,
        output: { availability: "process_local_unavailable" },
      },
    ]);
    fireEvent.click(
      await screen.findByRole("button", { name: "! printf known, completed · exit 7" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Recorded stdout").textContent).toBe(command.stdout),
    );
    expect(screen.getByLabelText("Canonical command preview").textContent).toBe("printf known");
    expect(f.container.querySelector("img")).toBeNull();
    expect(
      screen.getByRole("article", { name: "Recorded terminal activity" }).textContent,
    ).toContain("completed · exit 7");
    expect(screen.getByText(/no restored live handle/)).toBeTruthy();
    expect(f.api.attachExecution).not.toHaveBeenCalled();
    expectNoProcessAction(f.api);
  });
});
