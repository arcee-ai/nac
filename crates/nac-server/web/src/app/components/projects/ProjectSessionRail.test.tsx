/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectSessionRail } from "@/app/components/projects/ProjectSessionRail";
import type { ManagedSessionSummary, SessionBehavior } from "@/app/types/api";

vi.mock("@/app/hooks/useSessionTitle", () => ({
  useSessionTitle: () => (summary: { title: string | null }) => summary.title ?? "Untitled",
}));
vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
}));
vi.mock("@/app/providers/ProjectActionsProvider", () => ({
  useProjectActions: () => ({ newChat: vi.fn() }),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

function session(
  projectId: string,
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
      project_id: projectId,
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

describe("project session rail", () => {
  it("exposes readable behavior identities and the current chat in labeled navigation", () => {
    const projectId = "rail-behavior-project";
    const sessions = [
      session(
        projectId,
        "rail-orchestrator",
        "Plan the managed deployment rollout",
        "orchestrator",
      ),
      session(projectId, "rail-direct", "Implement connection status feedback", "direct"),
      session(
        projectId,
        "rail-hybrid",
        "Coordinate release readiness review",
        "direct-with-orchestrator",
      ),
    ];
    render(
      <MemoryRouter>
        <ProjectSessionRail
          projectId={projectId}
          sessions={sessions}
          activeSessionId="rail-direct"
          collapsed={false}
          onToggleCollapsed={vi.fn()}
        />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole("navigation", { name: "Project chats" });
    expect(
      within(navigation).getByRole("button", {
        name: "Plan the managed deployment rollout, NAC orchestrator",
      }),
    ).toBeTruthy();
    const current = within(navigation).getByRole("button", {
      name: "Implement connection status feedback, Direct coding agent",
    });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.className).toContain("focus-visible:outline");
    expect(
      within(navigation).getByRole("button", {
        name: "Coordinate release readiness review, Direct + NAC orchestration",
      }),
    ).toBeTruthy();
    expect(within(navigation).getByRole("button", { name: "Create new session" })).toBeTruthy();
    expect(
      within(navigation).getByRole("button", { name: "All chats in this project" }),
    ).toBeTruthy();
  });

  it("provides keyboard-focusable ordering controls that update the saved rail order", () => {
    const projectId = "rail-order-project";
    const sessions = [
      session(projectId, "order-plan", "Plan", "orchestrator"),
      session(projectId, "order-code", "Code", "direct"),
      session(projectId, "order-coordinate", "Coordinate", "direct-with-orchestrator"),
    ];
    render(
      <MemoryRouter>
        <ProjectSessionRail
          projectId={projectId}
          sessions={sessions}
          activeSessionId="order-code"
          collapsed={false}
          onToggleCollapsed={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for Plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));

    const rowTitles = Array.from(
      screen
        .getByRole("navigation", { name: "Project chats" })
        .querySelectorAll<HTMLButtonElement>('button[title*=" · "]'),
    ).map((button) => button.title);
    expect(rowTitles).toEqual([
      "Code · Direct coding agent",
      "Plan · NAC orchestrator",
      "Coordinate · Direct + NAC orchestration",
    ]);
  });

  it("reduces to an accessible expand control when collapsed", () => {
    const onToggleCollapsed = vi.fn();
    render(
      <MemoryRouter>
        <ProjectSessionRail
          projectId="rail-collapsed-project"
          sessions={[]}
          activeSessionId="missing"
          collapsed
          onToggleCollapsed={onToggleCollapsed}
        />
      </MemoryRouter>,
    );

    const expand = screen.getByRole("button", { name: "Expand project chats" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expand);
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });
});
