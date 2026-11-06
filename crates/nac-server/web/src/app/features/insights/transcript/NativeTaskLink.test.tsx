/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { NativeTaskLink } from "./NativeTaskLink";
import { TranscriptGroupBadge } from "./TranscriptGroupBadge";
import { indexToolEvents, presentToolCall } from "@/app/lib/toolPresentation";
import type { ManagedSessionSummary } from "@/app/types/api";

const state = vi.hoisted(() => ({
  caller: "caller",
  sessions: [] as ManagedSessionSummary[],
  inventoryIntervals: [] as number[],
}));
vi.mock("./transcriptTurns", () => ({ useTranscriptSessionId: () => state.caller }));
vi.mock("@/app/services/queries/session", () => ({
  useSessions: (interval: number) => {
    state.inventoryIntervals.push(interval);
    return { data: state.sessions };
  },
}));
afterEach(() => {
  cleanup();
  state.sessions = [];
  state.caller = "caller";
  state.inventoryIntervals = [];
});
const task = {
  sessionId: "38e19c14-37b7-4b7e-a687-a628529b088f",
  projectId: "saved-project",
  callerId: "caller",
  title: "Separate brief",
};
const known = {
  summary: {
    session_id: task.sessionId,
    project_id: task.projectId,
    behavior: "direct",
    title: "Verified task",
  },
  lineage: null,
} as ManagedSessionSummary;
function mount() {
  render(
    <MemoryRouter>
      <NativeTaskLink task={task} />
    </MemoryRouter>,
  );
}

it("opens the exact known independent task through the app router", () => {
  state.sessions = [known];
  mount();
  expect(
    screen.getByRole("link", { name: "Open separate task: Verified task" }).getAttribute("href"),
  ).toBe(`/session/${task.sessionId}/insights`);
});

it.each(["unknown", "other caller", "other project", "delegated", "orchestrator"])(
  "withholds a receipt link for %s",
  (reason) => {
    const entry = structuredClone(known);
    if (reason === "other caller") state.caller = "other";
    if (reason === "other project") entry.summary.project_id = "other";
    if (reason === "delegated")
      entry.lineage = {
        kind: "traditional-child",
        parent_session_id: "caller",
        root_session_id: "caller",
        description: "Child",
      };
    if (reason === "orchestrator") entry.summary.behavior = "orchestrator";
    if (reason !== "unknown") state.sessions = [entry];
    mount();
    expect(screen.queryByRole("link")).toBeNull();
  },
);

vi.mock("@/app/features/insights/useInsightsNavigation", () => ({
  INSIGHTS_DETAIL_ID: "insights-detail",
  useInsightsNavigation: () => ({ openGroup: vi.fn() }),
}));

function CurrentRoute() {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}

function mountErrorReceipt({
  phase = "ready",
  navigation = `/session/${task.sessionId}`,
  interactive = true,
} = {}) {
  const presentation = presentToolCall({
    call: { id: "launch", type: "function", function: { name: "launch_task", arguments: "{}" } },
    events: indexToolEvents([
      {
        type: "tool_call_finished",
        call_id: "launch",
        thread_name: null,
        name: "launch_task",
        content_preview: "initial input admission failed: operation lease unavailable",
        is_error: true,
        completion_status: "error",
      },
    ]).get("launch"),
    hasResult: true,
    resultText: JSON.stringify({
      navigation,
      launch: {
        session_id: task.sessionId,
        caller_session_id: task.callerId,
        project_id: task.projectId,
        phase,
        error: "initial input admission failed: operation lease unavailable",
        request: { request_id: task.sessionId, title: task.title },
      },
    }),
    resultHasImage: false,
    active: false,
    turnCancelled: false,
  });
  render(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      <CurrentRoute />
      <TranscriptGroupBadge
        group={{
          id: "launch-group",
          status: "failed",
          durationMs: null,
          segments: [
            {
              kind: "tool",
              key: "launch",
              name: "launch_task",
              action: "other",
              pending: false,
              presentation,
            },
          ],
        }}
        active={false}
        trailing={false}
        selected={false}
        interactive={interactive}
      />
    </MemoryRouter>,
  );
  return presentation;
}

it("opens a verified READY task from the actual error-finished receipt badge", () => {
  state.sessions = [known];
  const presentation = mountErrorReceipt();
  expect(presentation.status).toBe("error");
  expect(presentation.statusLabel).toBe("Failed");
  expect(presentation.resultPreview).toBe(
    "initial input admission failed: operation lease unavailable",
  );
  const link = screen.getByRole("link", { name: "Open separate task: Verified task" });
  expect(link.getAttribute("href")).toBe(`/session/${task.sessionId}/insights`);
  expect(state.inventoryIntervals).toEqual([0]);
  fireEvent.click(link);
  expect(screen.getByLabelText("Current route").textContent).toBe(
    `/session/${task.sessionId}/insights`,
  );
});

it("withholds a pre-publication failure link despite a syntactically valid reserved identity", () => {
  mountErrorReceipt({ phase: "failed" });
  expect(screen.queryByRole("link")).toBeNull();
  expect(state.inventoryIntervals).toEqual([0]);
});

it.each(["other caller", "other project", "delegated", "orchestrator", "hybrid"])(
  "withholds the error-receipt link for %s",
  (reason) => {
    const entry = structuredClone(known);
    if (reason === "other caller") state.caller = "other";
    if (reason === "other project") entry.summary.project_id = "other";
    if (reason === "delegated")
      entry.lineage = {
        kind: "traditional-child",
        parent_session_id: "caller",
        root_session_id: "caller",
        description: "Child",
      };
    if (reason === "orchestrator") entry.summary.behavior = "orchestrator";
    if (reason === "hybrid") entry.summary.behavior = "direct-with-orchestrator";
    state.sessions = [entry];
    mountErrorReceipt();
    expect(screen.queryByRole("link")).toBeNull();
  },
);

it("does not turn malformed error navigation into a link even for a known task", () => {
  state.sessions = [known];
  mountErrorReceipt({ navigation: "https://example.test/" });
  expect(screen.queryByRole("link")).toBeNull();
});

it("keeps historical noninteractive error receipts without navigation controls", () => {
  state.sessions = [known];
  mountErrorReceipt({ interactive: false });
  expect(screen.queryByRole("link")).toBeNull();
  expect(state.inventoryIntervals).toEqual([]);
});
