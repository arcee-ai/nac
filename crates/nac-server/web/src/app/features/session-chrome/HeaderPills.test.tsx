/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeaderPills } from "@/app/features/session-chrome/HeaderPills";
import type { SessionDrawerControls } from "@/app/features/session-chrome/useSessionDrawer";
import type { SessionFacts } from "@/app/features/session-chrome/useSessionFacts";
import { sessionPanelPolicy } from "@/app/lib/sessionBehavior";
import type { SessionGoalRecord } from "@/app/types/api";

vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
  useIsDesktop: () => true,
  useMediaQuery: () => false,
}));

afterEach(cleanup);

function facts(overrides: Partial<SessionFacts> = {}): SessionFacts {
  return {
    title: "Session",
    behavior: "direct",
    lineage: null,
    parent: null,
    policy: sessionPanelPolicy("direct", null),
    readOnly: false,
    direct: true,
    meta: [],
    repo: null,
    branch: null,
    environment: "Local",
    status: "idle",
    running: false,
    additions: 0,
    deletions: 0,
    agents: null,
    goal: null,
    terminal: false,
    schedules: 0,
    ...overrides,
  };
}

function drawer(open: string | null = null): SessionDrawerControls {
  return {
    open: open != null,
    pinned: false,
    expanded: false,
    content: open === "goal" ? "goal" : "panel",
    panel: "insights",
    showing: (target) => target === open,
    toggle: vi.fn(),
    openPanel: vi.fn(),
    close: vi.fn(),
    togglePinned: vi.fn(),
    toggleExpanded: vi.fn(),
  };
}

describe("header pills", () => {
  it("renders nothing for a quiet session", () => {
    const { container } = render(<HeaderPills facts={facts()} drawer={drawer()} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows only the pills with content, keeping the panel names in their accessible names", () => {
    const controls = drawer("files");
    render(
      <HeaderPills
        facts={facts({
          additions: 12,
          deletions: 3,
          agents: { count: 3, running: 1, panel: "delegated", noun: "agent" },
          goal: { status: "paused", objective: "Ship it" } as SessionGoalRecord,
          terminal: true,
          schedules: 2,
        })}
        drawer={controls}
      />,
    );
    const files = screen.getByRole("button", { name: "Files: +12 −3" });
    expect(files.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("button", { name: "Subagents: 3 agents, 1 running" }).textContent,
    ).toContain("3 agents");
    expect(screen.getByRole("button", { name: "Goal: paused" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Terminal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Heartbeats: 2 schedules" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Subagents: 3 agents, 1 running" }));
    expect(controls.toggle).toHaveBeenCalledWith("delegated");
    fireEvent.click(screen.getByRole("button", { name: "Goal: paused" }));
    expect(controls.toggle).toHaveBeenCalledWith("goal");
  });

  it("follows the behavior's panels: an orchestrator has no terminal or schedules", () => {
    render(
      <HeaderPills
        facts={facts({
          behavior: "orchestrator",
          policy: sessionPanelPolicy("orchestrator", null),
          additions: 1,
          schedules: 4,
          agents: { count: 2, running: 0, panel: "worksets", noun: "thread" },
        })}
        drawer={drawer()}
      />,
    );
    expect(screen.getByRole("button", { name: "Files: +1 −0" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Threads: 2 threads" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Heartbeats/ })).toBeNull();
  });
});
