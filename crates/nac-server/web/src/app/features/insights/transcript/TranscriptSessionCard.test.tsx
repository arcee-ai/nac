/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { InsightSessionEntry } from "@/app/features/insights/model/types";
import { TranscriptSessionCard } from "./TranscriptSessionCard";
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
      function: { name, arguments: '{"profile":"unknown", "secret":"RAW_SECRET"}' },
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
  if (name === "subagent" && status === "pending")
    presentation.label = "Subagent awaiting approval";
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
  launch: InsightSessionEntry,
  {
    children,
    orchestration = true,
    interactive = true,
  }: { children?: TraditionalChildRecord[]; orchestration?: boolean; interactive?: boolean } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  if (children) client.setQueryData(queryKeys.traditionalChildren("parent"), children);
  render(
    <QueryClientProvider client={client}>
      <UiPolicyContext.Provider value={{ orchestrationEnabled: orchestration }}>
        <MemoryRouter initialEntries={["/session/parent/insights"]}>
          <Location />
          <Routes>
            <Route
              path="/session/:sessionId/insights"
              element={<TranscriptSessionCard entry={launch} interactive={interactive} />}
            />
          </Routes>
        </MemoryRouter>
      </UiPolicyContext.Provider>
    </QueryClientProvider>,
  );
  return client;
}

it.each(["subagent", "orchestrator_launch"] as const)(
  "keeps a failed %s launch's bounded diagnostic without a child",
  async (name) => {
    const launch = entry(name);
    mount(launch);
    if (name === "subagent") {
      expect(launch.presentation.resultPreview).toBeNull();
      expect(screen.getByText("Subagent request failed", { exact: true })).toBeTruthy();
    } else {
      const diagnostic = screen.getByText(launch.presentation.resultPreview!, { exact: true });
      expect(diagnostic.textContent).toBe(launch.presentation.resultPreview);
      expect([...diagnostic.textContent!].length).toBeLessThanOrEqual(180);
    }
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
    expect(screen.queryByText(/Current:/)).toBeNull();
    expect(screen.getByRole("link", { name: "Go to session Audit persistence" })).toBeTruthy();
  },
);

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
    expect(screen.getByRole("link", { name: "Go to session Audit persistence" })).toBeTruthy();
  },
);

it("keeps the generic title when a legacy invocation has no sanitized summary", () => {
  const invocation = entry("subagent", "ready", "child");
  invocation.title = "Subagent";
  invocation.presentation.summary = null;
  mount(invocation, { children: [{ ...child, description: "RAW_MANAGED_EXACT_SECRET" }] });
  expect(document.body.textContent).not.toContain("RAW_MANAGED_EXACT_SECRET");
  expect(screen.getByRole("link", { name: "Go to session Subagent" })).toBeTruthy();
});

it("keeps a continuation without a verified description generic", () => {
  const invocation = entry("subagent", "ready", "child");
  invocation.title = "Subagent";
  invocation.presentation.summary = null;
  invocation.presentation.delegationIntent = "background_continuation";
  mount(invocation, { children: [{ ...child, description: "RAW_MANAGED_EXACT_SECRET" }] });
  expect(document.body.textContent).not.toContain("RAW_MANAGED_EXACT_SECRET");
  expect(screen.getByRole("link", { name: "Go to session Subagent" })).toBeTruthy();
});

it("keeps the historical invocation separate from the child's newer status", () => {
  const invocation = entry("subagent", "ready", "child");
  invocation.presentation.label = "Instructions sent to subagent";
  invocation.presentation.resultPreview = "Instructions sent to subagent";
  mount(invocation, { children: [{ ...child, status: "running", generation: 2 }] });
  expect(screen.getByText("Instructions sent to subagent · Current:")).toBeTruthy();
  expect(screen.getByText("Working…")).toBeTruthy();
  fireEvent.click(screen.getByText("Invocation details"));
  expect(screen.getByText("Instructions sent to subagent", { selector: "pre" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Go to session Audit persistence" })).toBeTruthy();
});

it("navigates launch links inside a hosted MemoryRouter and leaves modified clicks alone", () => {
  mount(entry("subagent", "ready", "child"), { children: [child] });
  const link = screen.getByRole("link", { name: "Go to session Audit persistence" });
  const modified = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
  let routerPrevented = true;
  const stopBrowserNavigation = (event: MouseEvent) => {
    routerPrevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", stopBrowserNavigation, { once: true });
  fireEvent(link, modified);
  expect(routerPrevented).toBe(false);
  expect(screen.getByRole("status", { name: "Route" }).textContent).toBe(
    "/session/parent/insights",
  );
  fireEvent.click(link);
  expect(screen.getByRole("status", { name: "Route" }).textContent).toBe("/session/child/insights");
});

it("keeps a disabled-policy orchestrator launch's own title rather than claiming it was not found", () => {
  mount(entry("orchestrator_launch", "ready", "orchestrator"), { orchestration: false });
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
    () => expect(screen.getByRole("link", { name: "Go to session New orchestrator" })).toBeTruthy(),
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
