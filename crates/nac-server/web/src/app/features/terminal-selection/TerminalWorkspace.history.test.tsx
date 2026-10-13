/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import type {
  ExecutionHistoryEntry,
  ExecutionStatus,
} from "../../../../packages/nac-client/src/types";
import { TerminalWorkspace } from "./TerminalWorkspace";

const observation = vi.hoisted(() => ({ open: vi.fn(), capture: vi.fn() }));
vi.mock("@/app/features/terminal/TerminalPane", () => ({
  TerminalPane: ({
    history,
  }: {
    history?: (observe: (source: ExecutionStatus) => void) => ReactNode;
  }) => <section aria-label="Session terminal">{history?.(observation.open)}</section>,
}));
vi.mock("./useSelectionReview", () => ({
  useSelectionReview: () => ({ controller: { capture: observation.capture }, state: {} }),
}));

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
});

it("composes history through the existing observation slot without a recovering session snapshot read", async () => {
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
    listExecutionHistory: vi.fn(async () => ({
      protocol_version: 1,
      history: { entries: [entry], limit: 32, older_entries_omitted: false },
    })),
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
  await screen.findByRole("option", { name: /Human shell/ });
  fireEvent.change(screen.getByLabelText("Recent activity"), { target: { value: entry.id } });
  fireEvent.click(screen.getByRole("button", { name: "Reopen retained output" }));
  expect(observation.open.mock.calls[0][0]).toMatchObject({
    id: "human-source",
    input: false,
    resize: false,
    stop: false,
    retained: true,
  });
  expect(api.getSession).not.toHaveBeenCalled();
  expect(observation.capture).not.toHaveBeenCalled();
  expect(api.openUserTerminal).not.toHaveBeenCalled();
  expect(api.inputUserTerminal).not.toHaveBeenCalled();
  expect(api.resizeUserTerminal).not.toHaveBeenCalled();
  expect(api.stopExecution).not.toHaveBeenCalled();
});
