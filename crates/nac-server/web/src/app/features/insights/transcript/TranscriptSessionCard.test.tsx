/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { InsightSessionEntry } from "@/app/features/insights/model/types";
import { TranscriptSessionCard, TranscriptSessionGroup } from "./TranscriptSessionCard";
import { InsightsNavigationContext } from "@/app/features/insights/useInsightsNavigation";
import { UiPolicyContext } from "@/app/features/ui-policy/UiPolicyContext";
import { presentToolCall } from "@/app/lib/toolPresentation";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import type { ManagedOrchestratorRecord, TraditionalChildRecord } from "@/app/types/api";

const listChildren = vi.spyOn(api, "listTraditionalChildren");
const listOrchestrators = vi.spyOn(api, "listManagedOrchestrators");
const clients: QueryClient[] = [];

beforeEach(() => {
  listChildren.mockReset().mockResolvedValue([]);
  listOrchestrators.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

function entry(
  name: "subagent" | "orchestrator_launch" = "subagent",
  status: InsightSessionEntry["status"] = "failed",
  childId?: string,
): InsightSessionEntry {
  const presentation = presentToolCall({
    call: {
      id: "launch",
      type: "function",
      function: {
        name,
        arguments: '{"profile":"unknown", "secret":"RAW_SECRET"}',
      },
    },
    hasResult: true,
    resultText: "RAW_RESULT_BODY",
    resultHasImage: false,
    active: false,
    turnCancelled: false,
    events: {
      finished: {
        type: "tool_call_finished",
        call_id: "launch",
        thread_name: null,
        name,
        content_preview: `Unknown profile. ${"Safe diagnostic ".repeat(30)}`,
        is_error: true,
      },
    },
  });
  if (childId) presentation.spawnedSessionId = childId;
  presentation.statusLabel = status === "pending" ? "Awaiting approval" : "Failed";
  return {
    kind: "session",
    id: "launch",
    action: name === "subagent" ? "spawn-agent" : "spawn-orchestrator",
    rowKey: childId ? `child:${childId}` : null,
    title: "Audit persistence",
    status,
    presentation,
  };
}

const child = {
  child_session_id: "child",
  description: "Known child",
  status: "completed",
  generation: 1,
  version: 1,
} as TraditionalChildRecord;

function Location() {
  return <output aria-label="Route">{useLocation().pathname}</output>;
}

function mount(
  launch: InsightSessionEntry | InsightSessionEntry[],
  {
    children,
    orchestration = true,
    interactive = true,
  }: {
    children?: TraditionalChildRecord[];
    orchestration?: boolean;
    interactive?: boolean;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  if (children) client.setQueryData(queryKeys.traditionalChildren("parent"), children);
  render(
    <QueryClientProvider client={client}>
      <UiPolicyContext.Provider value={{ orchestrationEnabled: orchestration }}>
        <MemoryRouter initialEntries={["/session/parent/insights"]}>
          <Location />
          <InsightsNavigationContext.Provider
            value={{
              sessionId: "parent",
              panels: ["delegated"],
              focusPanel: vi.fn(),
              detailFocusRef: { current: null },
            }}
          >
            <Routes>
              <Route
                path="/session/:sessionId/insights"
                element={
                  Array.isArray(launch) ? (
                    <TranscriptSessionGroup entries={launch} interactive={interactive} />
                  ) : (
                    <TranscriptSessionCard entry={launch} interactive={interactive} />
                  )
                }
              />
            </Routes>
          </InsightsNavigationContext.Provider>
        </MemoryRouter>
      </UiPolicyContext.Provider>
    </QueryClientProvider>,
  );
  return client;
}

it("shares a target only after the parent owns the child", async () => {
  const first = entry("subagent", "ready", "child");
  const second = { ...entry("subagent", "failed", "child"), id: "second" };
  let resolveChildren!: (value: TraditionalChildRecord[]) => void;
  listChildren.mockReturnValue(
    new Promise((resolve) => {
      resolveChildren = resolve;
    }),
  );
  mount([first, second]);
  expect(screen.getAllByText("Audit persistence")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: /Open .* in Subagents/ })).toBeNull();
  resolveChildren([child]);
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "Open Known child in Subagents" })).toHaveLength(
      1,
    ),
  );
  expect(screen.getByText("Subagent · Start · Failed")).toBeTruthy();
});

it.each(["missing", "failed"])(
  "keeps both targets visible when the child list is %s",
  async (state) => {
    if (state === "failed") listChildren.mockRejectedValue(new Error("unavailable"));
    mount([
      entry("subagent", "ready", "foreign"),
      { ...entry("subagent", "failed", "foreign"), id: "second" },
    ]);
    await waitFor(() =>
      expect(
        screen.getAllByText(state === "failed" ? "Session unavailable" : "Session not found"),
      ).toHaveLength(2),
    );
    expect(screen.getAllByText("Audit persistence")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Open .* in Subagents/ })).toBeNull();
  },
);

it("shows an ambiguous settled outcome without claiming interruption", () => {
  const launch = entry("subagent", "ready");
  launch.presentation.status = "unknown";
  launch.presentation.statusLabel = "Outcome unavailable";
  launch.presentation.resultPreview = null;
  mount(launch);
  expect(screen.getByText("Subagent · Start · Outcome unavailable")).toBeTruthy();
  expect(screen.queryByText(/Interrupted|No result was recorded/)).toBeNull();
});

it.each(["subagent", "orchestrator_launch"] as const)(
  "keeps a failed %s launch's bounded diagnostic without a child",
  async (name) => {
    const launch = entry(name);
    mount(launch);
    const diagnostic = screen.getByText(launch.presentation.resultPreview!, {
      exact: true,
    });
    expect(diagnostic.textContent).toBe(launch.presentation.resultPreview);
    expect([...diagnostic.textContent!].length).toBeLessThanOrEqual(180);
    expect(document.body.textContent).not.toMatch(/RAW_SECRET|RAW_RESULT_BODY/);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    await waitFor(() =>
      expect(name === "subagent" ? listChildren : listOrchestrators).toHaveBeenCalled(),
    );
  },
);

it("keeps the failure status readable when no preview was retained", () => {
  const launch = entry();
  launch.presentation.resultPreview = null;
  mount(launch, { interactive: false });
  expect(screen.getByText("Subagent · Start · Failed", { exact: true })).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

it.each(["pending", "failed"] as const)(
  "preserves a refused continuation's %s status over an old completed child",
  (status) => {
    mount(entry("subagent", status, "child"), { children: [child] });
    expect(
      screen.getByText(
        status === "pending" ? "Subagent · Start · Awaiting approval" : "Subagent · Start · Failed",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Known child in Subagents" })).toBeTruthy();
  },
);

it("keeps a successful continuation on the child's live status", () => {
  mount(entry("subagent", "ready", "child"), { children: [child] });
  expect(screen.queryByText("Failed")).toBeNull();
  expect(screen.queryByRole("note")).toBeNull();
  expect(listChildren).not.toHaveBeenCalled();
});

it("offers a panel target without navigating away from the parent", () => {
  mount(entry("subagent", "ready", "child"), { children: [child] });
  fireEvent.click(screen.getByRole("button", { name: "Open Known child in Subagents" }));
  expect(screen.getByRole("status", { name: "Route" }).textContent).toBe(
    "/session/parent/insights",
  );
  expect(screen.queryByRole("link")).toBeNull();
});

it("retains the original invocation result when the child advances or disappears", async () => {
  const getContent = vi.spyOn(api, "getToolCallContent").mockResolvedValue({
    call_id: "launch",
    arguments: "{}",
    arguments_truncated: false,
    output: JSON.stringify({
      child_session_id: "child",
      generation: 1,
      status: "completed",
      report: "first result",
    }),
    output_truncated: false,
  });
  const launch = entry("subagent", "ready", "child");
  const client = mount(launch, { children: [{ ...child, generation: 2 }] });
  fireEvent.click(screen.getByText("Invocation result"));
  await waitFor(() => expect(screen.getByText(/first result/)).toBeTruthy());
  client.setQueryData(queryKeys.traditionalChildren("parent"), []);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Open Known child in Subagents" })).toBeNull(),
  );
  expect(screen.getByText(/first result/)).toBeTruthy();
  expect(getContent).toHaveBeenCalledWith("parent", "launch", expect.any(AbortSignal));
  getContent.mockRestore();
});

it("keeps waiting when a finished call's batch has not committed its result yet", async () => {
  const response = {
    call_id: "launch",
    arguments: "{}",
    arguments_truncated: false,
    output: null as string | null,
    output_truncated: false,
  };
  const getContent = vi
    .spyOn(api, "getToolCallContent")
    .mockResolvedValueOnce(response)
    .mockResolvedValue({ ...response, output: "late result" });
  const launch = entry("subagent", "ready", "child");
  launch.presentation.resultMayBePending = true;
  mount(launch, { children: [child] });
  fireEvent.click(screen.getByText("Invocation result"));
  await screen.findByText("Waiting for invocation result…");
  await screen.findByText("late result", {}, { timeout: 3500 });
  expect(getContent).toHaveBeenCalledTimes(2);
  getContent.mockRestore();
}, 5000);

it("reports an unavailable invocation and retries without showing a cached result", async () => {
  const getContent = vi.spyOn(api, "getToolCallContent").mockRejectedValue(new Error("ambiguous"));
  mount(entry("subagent", "ready", "child"), { children: [child] });
  fireEvent.click(screen.getByText("Invocation result"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not load"));
  getContent.mockResolvedValue({
    call_id: "launch",
    arguments: "{}",
    arguments_truncated: false,
    output: "safe result",
    output_truncated: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByText("safe result")).toBeTruthy());
  expect(screen.getByText("Result truncated at 256 KiB.")).toBeTruthy();
  getContent.mockRestore();
});

it("keeps a disabled-policy orchestrator launch's own title rather than claiming it was not found", () => {
  mount(entry("orchestrator_launch", "ready", "orchestrator"), {
    orchestration: false,
  });
  expect(screen.getByText("Audit persistence")).toBeTruthy();
  expect(screen.queryByText("Not found")).toBeNull();
  expect(listOrchestrators).not.toHaveBeenCalled();
});

it("keeps polling when a settled launch's child has not appeared in the first list", async () => {
  const record = {
    orchestrator_session_id: "orchestrator",
    description: "New orchestrator",
    status: "completed",
    generation: 1,
    version: 1,
  } as ManagedOrchestratorRecord;
  listOrchestrators.mockResolvedValueOnce([]).mockResolvedValue([record]);
  mount(entry("orchestrator_launch", "ready", "orchestrator"));
  await waitFor(
    () =>
      expect(
        screen.getByRole("button", {
          name: "Open New orchestrator in Subagents",
        }),
      ).toBeTruthy(),
    { timeout: 2500 },
  );
  expect(listOrchestrators).toHaveBeenCalledTimes(2);
});

it("stops polling after a delegation list fetch fails", async () => {
  listOrchestrators.mockRejectedValue(new Error("offline"));
  mount(entry("orchestrator_launch", "ready", "orchestrator"));
  await waitFor(() => expect(listOrchestrators).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  expect(listOrchestrators).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Not found")).toBeNull();
});
