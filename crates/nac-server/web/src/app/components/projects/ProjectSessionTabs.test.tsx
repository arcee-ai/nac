/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectSessionTabs } from "@/app/components/projects/ProjectSessionTabs";
import type { ManagedSessionSummary, SessionBehavior } from "@/app/types/api";

vi.mock("@/app/hooks/useSessionTitle", () => ({
  useSessionTitle: () => (summary: { title: string | null }) => summary.title ?? "Untitled",
}));
vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
}));
vi.mock("@/app/providers/ProjectActionsProvider", () => ({
  useProjectActions: () => ({ newChat: vi.fn(), assign: vi.fn() }),
}));
vi.mock("@/app/providers/SessionActionsProvider", () => ({
  useSessionActions: () => ({ remove: vi.fn() }),
}));

function session(
  sessionId: string,
  title: string,
  behavior: SessionBehavior,
): ManagedSessionSummary {
  return {
    active: false,
    active_run: null,
    lineage: null,
    summary: {
      backend: "openai-responses",
      behavior,
      created_at: "2026-08-28T12:00:00Z",
      cwd: "/workspace",
      forked_from: null,
      last_user_prompt: null,
      model: "gpt-5.6-sol",
      project_id: "project",
      sandboxed: false,
      session_id: sessionId,
      ssh_host: null,
      title,
      updated_at: "2026-08-28T12:00:00Z",
      visible_message_count: 1,
    },
    workspace_diff: null,
  };
}

afterEach(cleanup);

describe("project session tab behavior identity", () => {
  it("keeps every behavior identifiable in the compact tab strip", () => {
    const sessions = [
      session("orchestrator", "Plan", "orchestrator"),
      session("direct", "Code", "direct"),
      session("hybrid", "Coordinate", "direct-with-orchestrator"),
    ];
    render(
      <MemoryRouter>
        <ProjectSessionTabs
          projectId="project"
          sessions={sessions}
          activeSessionId="direct"
          summary={sessions[1].summary}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Plan, NAC orchestrator" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Code, Direct coding agent" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("button", { name: "Coordinate, Direct + NAC orchestration" }),
    ).toBeTruthy();
  });
});
