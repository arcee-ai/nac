/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import type { ExecutionHistoryEntry } from "../../../../packages/nac-client/src/types";
import { RecentExecutionHistory } from "./RecentExecutionHistory";
import { executionHistoryKey } from "./historyQueries";

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
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

function fixture(entries = [entry]) {
  const response = {
    protocol_version: 1,
    history: { entries, limit: 32, older_entries_omitted: false },
  };
  const api = {
    ...standaloneRuntime.api,
    listExecutionHistory: vi.fn(async () => response),
    attachExecution: vi.fn(),
    openUserTerminal: vi.fn(),
    inputUserTerminal: vi.fn(),
    resizeUserTerminal: vi.fn(),
    stopExecution: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const reopen = vi.fn();
  const view = render(
    <RuntimeContext.Provider value={{ ...standaloneRuntime, api }}>
      <QueryClientProvider client={client}>
        <RecentExecutionHistory sessionId="session" onReopen={reopen} />
      </QueryClientProvider>
    </RuntimeContext.Provider>,
  );
  return { ...view, api, client, reopen };
}

describe("recent terminal activity", () => {
  it("lists and selects metadata without observing, launching or sending input", async () => {
    const f = fixture();
    await screen.findByRole("option", { name: /Human shell/ });
    fireEvent.change(screen.getByLabelText("Recent activity"), { target: { value: entry.id } });
    expect(screen.getByText("Retained output available.")).toBeTruthy();
    expect(f.reopen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reopen retained output" }));
    expect(f.reopen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "opaque-shell",
        input: false,
        resize: false,
        stop: false,
        retained: false,
      }),
      entry,
    );
    for (const operation of [
      f.api.attachExecution,
      f.api.openUserTerminal,
      f.api.inputUserTerminal,
      f.api.resizeUserTerminal,
      f.api.stopExecution,
    ])
      expect(operation).not.toHaveBeenCalled();
  });

  it("updates selected output expiry without recreating a handle", async () => {
    const f = fixture();
    await screen.findByRole("option", { name: /Human shell/ });
    fireEvent.change(screen.getByLabelText("Recent activity"), { target: { value: entry.id } });
    f.api.listExecutionHistory.mockResolvedValue({
      protocol_version: 1,
      history: {
        entries: [{ ...entry, output: { availability: "expired" } }],
        limit: 32,
        older_entries_omitted: false,
      },
    });
    await act(async () => {
      await f.client.invalidateQueries({ queryKey: executionHistoryKey("session") });
    });
    await screen.findByText("Output expired. The recorded outcome remains available.");
    expect(
      (screen.getByRole("button", { name: "Reopen retained output" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(f.reopen).not.toHaveBeenCalled();
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
    await screen.findByRole("option", { name: /Human command/ });
    fireEvent.change(screen.getByLabelText("Recent activity"), {
      target: { value: "command-request" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Recorded stdout").textContent).toBe(command.stdout),
    );
    expect(f.container.querySelector("img")).toBeNull();
    expect(
      screen.getByRole("article", { name: "Recorded terminal activity" }).textContent,
    ).toContain("completed · exit 7");
    expect(screen.getByText(/no restored live handle/)).toBeTruthy();
    expect(f.reopen).not.toHaveBeenCalled();
  });
});
