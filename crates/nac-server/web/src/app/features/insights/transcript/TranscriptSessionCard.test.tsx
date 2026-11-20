/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { InsightSessionEntry } from "@/app/features/insights/model/types";
import { TranscriptSessionCard, TranscriptSessionGroup } from "./TranscriptSessionCard";
import { InsightsNavigationContext } from "@/app/features/insights/useInsightsNavigation";
import { presentToolCall } from "@/app/lib/toolPresentation";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import type { TraditionalChildRecord } from "@/app/types/api";

const listChildren = vi.spyOn(api, "listTraditionalChildren");
const clients: QueryClient[] = [];

beforeEach(() => {
  listChildren.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

function entry(
  name: "subagent" = "subagent",
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
        name,
        content_preview: `Unknown profile. ${"Safe diagnostic ".repeat(30)}`,
        is_error: true,
      },
    },
  });
  if (childId) presentation.spawnedSessionId = childId;
  presentation.occurrence = "log:parent:store:1:digest:2";
  presentation.statusLabel = status === "pending" ? "Awaiting approval" : "Failed";
  if (name === "subagent" && status === "pending")
    presentation.label = "Subagent awaiting approval";
  if (name === "subagent" && status === "ready") {
    presentation.status = "success";
    presentation.label = "Subagent request finished";
  }
  return {
    kind: "session",
    id: "launch",
    action: "spawn-agent",
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
    interactive = true,
  }: {
    children?: TraditionalChildRecord[];
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
      <>
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
      </>
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
    expect(
      screen.getAllByRole("button", { name: "Open Audit persistence in Subagents" }),
    ).toHaveLength(1),
  );
  expect(screen.getByText("Subagent request failed")).toBeTruthy();
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

it.each(["subagent"] as const)(
  "keeps a failed %s launch's bounded diagnostic without a child",
  async (name) => {
    const launch = entry(name);
    mount(launch);
    expect(launch.presentation.resultPreview).toBeNull();
    expect(screen.getByText("Subagent request failed")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/RAW_SECRET|RAW_RESULT_BODY/);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    await waitFor(() => expect(listChildren).toHaveBeenCalled());
  },
);

it("keeps the failure status readable when no preview was retained", () => {
  const launch = entry();
  launch.presentation.resultPreview = null;
  mount(launch, { interactive: false });
  expect(screen.getByText("Subagent request failed", { exact: true })).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

it.each(["pending", "failed"] as const)(
  "preserves a refused continuation's %s status over an old completed child",
  (status) => {
    mount(entry("subagent", status, "child"), { children: [child] });
    expect(
      screen.getByText(
        status === "pending" ? "Subagent awaiting approval" : "Subagent request failed",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open Audit persistence in Subagents" }),
    ).toBeTruthy();
  },
);

it("keeps a successful continuation on the child's live status", () => {
  mount(entry("subagent", "ready", "child"), { children: [child] });
  expect(screen.queryByText("Failed")).toBeNull();
  expect(screen.queryByRole("note")).toBeNull();
  expect(listChildren).not.toHaveBeenCalled();
});

it("refreshes a cached completed child while an unbound invocation may still settle", async () => {
  const invocation = entry("subagent", "ready", "child");
  invocation.presentation.status = "unknown";
  invocation.presentation.statusLabel = "Outcome unavailable";
  invocation.presentation.inventoryMayChange = true;
  listChildren.mockResolvedValue([{ ...child, status: "running", generation: 2 }]);
  mount(invocation, { children: [child] });
  await waitFor(() => expect(listChildren).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText(/Current: Working/)).toBeTruthy());
  expect(screen.getByText(/Outcome unavailable/)).toBeTruthy();
});

it("refreshes cached inventory for an active ambiguous delegation without enabling result lookup", async () => {
  const invocation = entry("subagent", "ready", "child");
  const ambiguous = presentToolCall({
    call: { id: "duplicate", type: "function", function: { name: "subagent", arguments: "{}" } },
    hasResult: false,
    resultText: null,
    resultHasImage: false,
    active: true,
    turnCancelled: false,
    ambiguousResult: true,
    unboundEvents: true,
  });
  invocation.presentation = { ...ambiguous, spawnedSessionId: "child" };
  expect(ambiguous.resultMayBePending).toBe(false);
  expect(ambiguous.inventoryMayChange).toBe(true);
  const getContent = vi.spyOn(api, "getToolCallContent");
  listChildren.mockResolvedValue([{ ...child, status: "running", generation: 2 }]);
  mount(invocation, { children: [child] });
  await waitFor(() => expect(listChildren).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText(/Current: Working/)).toBeTruthy());
  expect(screen.getByText(/Outcome unavailable/)).toBeTruthy();
  fireEvent.click(screen.getByText("Invocation result"));
  expect(
    await screen.findByText("Invocation result unavailable because this call is ambiguous."),
  ).toBeTruthy();
  expect(getContent).not.toHaveBeenCalled();
  getContent.mockRestore();
});

it("offers a panel target without navigating away from the parent", () => {
  mount(entry("subagent", "ready", "child"), { children: [child] });
  fireEvent.click(screen.getByRole("button", { name: "Open Audit persistence in Subagents" }));
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
    expect(
      screen.queryByRole("button", { name: "Open Audit persistence in Subagents" }),
    ).toBeNull(),
  );
  expect(screen.getByText(/first result/)).toBeTruthy();
  expect(getContent).toHaveBeenCalledWith(
    "parent",
    "launch",
    expect.any(AbortSignal),
    "log:parent:store:1:digest:2",
  );
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

it("keeps polling when a settled launch's child has not appeared in the first list", async () => {
  const record = {
    child_session_id: "child",
    description: "New child",
    status: "completed",
    generation: 1,
    version: 1,
  } as TraditionalChildRecord;
  listChildren.mockResolvedValueOnce([]).mockResolvedValue([record]);
  mount(entry("subagent", "ready", "child"));
  await waitFor(
    () =>
      expect(
        screen.getByRole("button", {
          name: "Open Audit persistence in Subagents",
        }),
      ).toBeTruthy(),
    { timeout: 2500 },
  );
  expect(listChildren).toHaveBeenCalledTimes(2);
});

it("stops polling after a delegation list fetch fails", async () => {
  listChildren.mockRejectedValue(new Error("offline"));
  mount(entry("subagent", "ready", "child"));
  await waitFor(() => expect(listChildren).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  expect(listChildren).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Not found")).toBeNull();
});

it("never displays a raw inventory description in a traditional child target", () => {
  mount(entry("subagent", "ready", "child"), {
    children: [{ ...child, description: "RAW_MANAGED_EXACT_SECRET" }],
  });
  expect(document.body.textContent).not.toContain("RAW_MANAGED_EXACT_SECRET");
  expect(screen.getByRole("button", { name: "Open Audit persistence in Subagents" })).toBeTruthy();
});

it("keeps a trusted historical outcome separate from the current child status", () => {
  const invocation = entry("subagent", "ready", "child");
  invocation.presentation.label = "Instructions sent to subagent";
  invocation.presentation.delegationOutcome = "background_continued";
  mount(invocation, { children: [{ ...child, status: "running" }] });
  expect(screen.getByText("Instructions sent to subagent · Current: Working…")).toBeTruthy();
});

it.each([
  ["pending", "Subagent awaiting approval", "Awaiting approval"],
  ["failed", "Subagent request failed", "Failed"],
] as const)("shows the %s request status once", (status, invocationLabel, statusLabel) => {
  const invocation = entry("subagent", status, "child");
  invocation.presentation.label = invocationLabel;
  invocation.presentation.statusLabel = statusLabel;
  mount(invocation, { children: [child] });
  expect(screen.getByText(invocationLabel, { exact: true })).toBeTruthy();
  expect(screen.queryByText(statusLabel, { exact: true })).toBeNull();
  expect(document.body.textContent).not.toContain(`${invocationLabel} ·`);
  expect(screen.queryByText(/Current:/)).toBeNull();
});

it("does not repeat a generic rejection as its diagnostic", () => {
  const invocation = entry("subagent", "failed");
  invocation.presentation.label = "Subagent request failed";
  invocation.presentation.resultPreview = "Subagent request failed";
  mount(invocation);
  expect(screen.getAllByText("Subagent request failed", { exact: true })).toHaveLength(1);
});

it("distinguishes a confirmed child failure from a rejected request", () => {
  const invocation = entry("subagent", "failed");
  invocation.presentation.label = "Subagent failed";
  invocation.presentation.delegationOutcome = "failed";
  mount(invocation);
  expect(screen.getByText("Subagent failed", { exact: true })).toBeTruthy();
  expect(screen.queryByText("Subagent request failed")).toBeNull();
});

it("retains a distinct rejection diagnostic", () => {
  const invocation = entry("subagent", "failed");
  invocation.presentation.label = "Subagent request failed";
  invocation.presentation.resultPreview = "Permission denied";
  mount(invocation);
  expect(screen.getByText("Permission denied")).toBeTruthy();
});

it("keeps a successful continuation on the child's live status", () => {
  mount(entry("subagent", "ready", "child"), { children: [child] });
  expect(screen.queryByText("Failed")).toBeNull();
  expect(screen.queryByRole("note")).toBeNull();
  expect(listChildren).not.toHaveBeenCalled();
});

it("does not imply work before a pending invocation starts", () => {
  const invocation = entry("subagent", "running");
  invocation.presentation.status = "pending";
  invocation.presentation.statusLabel = "Pending";
  invocation.presentation.label = "Subagent pending";
  mount(invocation);
  expect(screen.getByText("Subagent pending", { exact: true })).toBeTruthy();
  expect(screen.queryByText("Pending", { exact: true })).toBeNull();
  expect(screen.queryByText("Working…")).toBeNull();
});

it("does not imply child work from an unvalidated legacy start", () => {
  const invocation = entry("subagent", "running");
  invocation.presentation.status = "running";
  invocation.presentation.statusLabel = "Running";
  invocation.presentation.label = "Subagent request in progress";
  mount(invocation);
  expect(screen.getByText("Subagent request in progress")).toBeTruthy();
  expect(screen.queryByText("Working…")).toBeNull();
});

it.each(["ready", "failed", "pending"] as const)(
  "does not render a raw child description from inventory in %s state",
  (status) => {
    const invocation = entry("subagent", status, "child");
    invocation.presentation.label = "Subagent request finished";
    mount(invocation, { children: [{ ...child, description: "RAW_MANAGED_EXACT_SECRET" }] });
    expect(document.body.textContent).not.toContain("RAW_MANAGED_EXACT_SECRET");
    expect(
      screen.getByRole("button", { name: "Open Audit persistence in Subagents" }),
    ).toBeTruthy();
  },
);

it("keeps the generic title when a legacy invocation has no sanitized summary", () => {
  const invocation = entry("subagent", "ready", "child");
  invocation.title = "Subagent";
  invocation.presentation.summary = null;
  mount(invocation, { children: [{ ...child, description: "RAW_MANAGED_EXACT_SECRET" }] });
  expect(document.body.textContent).not.toContain("RAW_MANAGED_EXACT_SECRET");
  expect(screen.getByRole("button", { name: "Open Subagent in Subagents" })).toBeTruthy();
});

it("keeps a continuation without a verified description generic", () => {
  const invocation = entry("subagent", "ready", "child");
  invocation.title = "Subagent";
  invocation.presentation.summary = null;
  invocation.presentation.delegationIntent = "background_continuation";
  mount(invocation, { children: [{ ...child, description: "RAW_MANAGED_EXACT_SECRET" }] });
  expect(document.body.textContent).not.toContain("RAW_MANAGED_EXACT_SECRET");
  expect(screen.getByRole("button", { name: "Open Subagent in Subagents" })).toBeTruthy();
});

it("keeps the historical invocation separate from the child's newer status", () => {
  const invocation = entry("subagent", "ready", "child");
  invocation.presentation.label = "Instructions sent to subagent";
  invocation.presentation.resultPreview = "Instructions sent to subagent";
  mount(invocation, { children: [{ ...child, status: "running", generation: 2 }] });
  expect(screen.getByText("Instructions sent to subagent · Current: Working…")).toBeTruthy();
  fireEvent.click(screen.getByText("Invocation details"));
  expect(screen.getByText("Instructions sent to subagent", { selector: "pre" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open Audit persistence in Subagents" })).toBeTruthy();
});
