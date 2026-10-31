/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { NativeTaskLink } from "./NativeTaskLink";
import type { ManagedSessionSummary } from "@/app/types/api";

const state = vi.hoisted(() => ({ caller: "caller", sessions: [] as ManagedSessionSummary[] }));
vi.mock("./transcriptTurns", () => ({ useTranscriptSessionId: () => state.caller }));
vi.mock("@/app/services/queries/session", () => ({
  useSessions: () => ({ data: state.sessions }),
}));
afterEach(() => {
  cleanup();
  state.sessions = [];
  state.caller = "caller";
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
