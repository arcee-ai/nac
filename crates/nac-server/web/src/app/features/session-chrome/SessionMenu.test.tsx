/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionMenu } from "@/app/features/session-chrome/SessionMenu";
import {
  sessionLiveFacts,
  sessionPanelEntries,
} from "@/app/features/session-chrome/sessionPanelEntries";
import type { SessionDrawerControls } from "@/app/features/session-chrome/useSessionDrawer";
import type { SessionFacts } from "@/app/features/session-chrome/useSessionFacts";
import { sessionPanelPolicy } from "@/app/lib/sessionBehavior";
import type { ManagedSessionSummary, SessionGoalRecord } from "@/app/types/api";

const state = vi.hoisted(() => ({
  phone: false,
  actions: { settings: vi.fn(), rename: vi.fn(), remove: vi.fn() },
}));

vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => state.phone,
  useIsTablet: () => false,
  useIsDesktop: () => !state.phone,
  useMediaQuery: () => false,
}));
vi.mock("@/app/runtime/RuntimeContext", () => ({
  useNativeRuntime: () => ({
    stores: { sessionLayoutStore: { useSelectedRevision: () => null, selectRevision: vi.fn() } },
  }),
}));
vi.mock("@/app/providers/SessionActionsProvider", () => ({
  useSessionActions: () => state.actions,
}));
vi.mock("@/app/providers/ToastProvider", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@/app/services/queries", () => ({
  useForkSession: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/app/features/session-chrome/useUsageReadings", () => ({
  useUsageReadings: () => ({}),
}));
vi.mock("@/app/components/inspector/SessionUsage", () => ({
  SessionUsageReadings: () => <span>usage readings</span>,
}));
vi.mock("@/app/components/inspector/BranchPicker", () => ({
  BranchPicker: ({ branch }: { branch: string }) => <span>{branch}</span>,
}));
vi.mock("@/app/components/inspector/RevisionPicker", () => ({
  RevisionPicker: () => <span>Live</span>,
}));
vi.mock("@/app/features/session-integrations/SessionIntegrations", () => ({
  SessionIntegrations: () => <span>integrations</span>,
}));

beforeEach(() => {
  state.phone = false;
  Object.values(state.actions).forEach((fn) => fn.mockClear());
});
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
    repo: "nac",
    branch: "ux/focus",
    environment: "Local",
    status: "idle",
    running: false,
    additions: 0,
    deletions: 0,
    agents: null,
    goal: null,
    terminal: true,
    schedules: 0,
    schedulesActive: false,
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
    show: vi.fn(),
    close: vi.fn(),
    togglePinned: vi.fn(),
    toggleExpanded: vi.fn(),
  };
}

const goal = (status: string) => ({ status, objective: "Ship it" }) as SessionGoalRecord;
const entry = { summary: { session_id: "s1", title: "Session" } } as ManagedSessionSummary;

function renderMenu(sessionFacts: SessionFacts, controls = drawer()) {
  render(
    <MemoryRouter>
      <SessionMenu
        sessionId="s1"
        snapshot={null}
        entry={entry}
        facts={sessionFacts}
        drawer={controls}
      />
    </MemoryRouter>,
  );
  return controls;
}

function openMenu(name = "Session menu") {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.getByRole("dialog", { name: "Session" });
}

describe("session panel entries", () => {
  it("lists a quiet wide session's terminal and Insights only", () => {
    expect(sessionPanelEntries(facts(), false)).toEqual(["terminal", "insights"]);
  });

  it("adds the panels with something to say, in one fixed order", () => {
    const busy = facts({
      additions: 12,
      deletions: 3,
      agents: { count: 2, running: 1, panel: "delegated" },
      goal: goal("paused"),
      schedules: 1,
    });
    expect(sessionPanelEntries(busy, false)).toEqual([
      "files",
      "delegated",
      "terminal",
      "goal",
      "heartbeats",
      "insights",
    ]);
  });

  it("lists every panel the behavior has on a phone, which has no tab strip", () => {
    expect(sessionPanelEntries(facts(), true)).toEqual([
      "files",
      "delegated",
      "terminal",
      "heartbeats",
      "insights",
      "history",
    ]);
  });

  it("follows the behavior's policy: a subagent transcript has no terminal or schedules", () => {
    const child = facts({
      policy: sessionPanelPolicy("direct", "traditional-child"),
      readOnly: true,
      additions: 1,
      schedules: 3,
    });
    expect(sessionPanelEntries(child, false)).toEqual(["files", "insights"]);
    expect(sessionPanelEntries(child, true)).toEqual(["files", "insights", "history"]);
  });
});

describe("live rule", () => {
  it("is quiet for changes alone, a paused goal or paused schedules", () => {
    expect(sessionLiveFacts(facts({ additions: 40, goal: goal("paused"), schedules: 2 }))).toEqual(
      [],
    );
  });

  it("names running subagents, an active goal and armed schedules", () => {
    expect(
      sessionLiveFacts(
        facts({
          agents: { count: 3, running: 2, panel: "delegated" },
          goal: goal("active"),
          schedules: 1,
          schedulesActive: true,
        }),
      ),
    ).toEqual(["2 subagents running", "Goal active", "Schedules active"]);
  });
});

describe("session menu", () => {
  it("keeps its name and draws a described dot only while something is live", () => {
    renderMenu(facts({ additions: 5 }));
    const quiet = screen.getByRole("button", { name: "Session menu" });
    expect(quiet.getAttribute("aria-describedby")).toBeNull();
    cleanup();

    renderMenu(facts({ agents: { count: 1, running: 1, panel: "delegated" } }));
    const live = screen.getByRole("button", { name: "Session menu" });
    expect(live.getAttribute("aria-describedby")).toBeTruthy();
    expect(live.querySelector(".status-dot-pulse")).not.toBeNull();
    expect(screen.getByText("1 subagent running")).toBeTruthy();
  });

  it("lists panels with their live facts, then details and actions", () => {
    renderMenu(
      facts({
        additions: 12,
        deletions: 3,
        agents: { count: 2, running: 1, panel: "delegated" },
        goal: goal("paused"),
        schedules: 2,
      }),
    );
    const menu = openMenu();
    const panels = within(menu)
      .getByRole("heading", { name: "Panels" })
      .closest("section") as HTMLElement;
    const names = within(panels)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual([
      "Files+12−3",
      "Subagents2, 1 running",
      "Terminal",
      "Goalpaused",
      "Heartbeats2",
      "Insights",
    ]);
    // Insights keeps its bare name: helpers and native journeys press it exactly.
    expect(within(menu).getByRole("button", { name: "Insights" })).toBeTruthy();
    expect(within(menu).getByText("ux/focus")).toBeTruthy();
    expect(within(menu).getByText("integrations")).toBeTruthy();
    expect(within(menu).getByText("usage readings")).toBeTruthy();
    for (const action of ["Session settings", "Fork from latest reply", "Rename", "Delete"])
      expect(within(menu).getByRole("button", { name: action })).toBeTruthy();
  });

  it("opens the drawer on the chosen panel and closes itself", () => {
    const controls = renderMenu(facts({ goal: goal("active") }), drawer("insights"));
    let menu = openMenu();
    expect(
      within(menu).getByRole("button", { name: "Insights" }).getAttribute("aria-current"),
    ).toBe("true");
    fireEvent.click(within(menu).getByRole("button", { name: "Terminal" }));
    expect(controls.show).toHaveBeenCalledWith("terminal");
    expect(screen.queryByRole("dialog", { name: "Session" })).toBeNull();

    menu = openMenu();
    fireEvent.click(within(menu).getByRole("button", { name: /^Goal/ }));
    expect(controls.show).toHaveBeenCalledWith("goal");

    menu = openMenu();
    fireEvent.click(within(menu).getByRole("button", { name: "Session settings" }));
    expect(state.actions.settings).toHaveBeenCalledWith("s1");
  });

  it("is the phone header's Open panel sheet, listing every panel", () => {
    state.phone = true;
    renderMenu(facts());
    const sheet = openMenu("Open panel");
    for (const name of ["Files", "Subagents", "Terminal", "Heartbeats", "Insights", "History"])
      expect(within(sheet).getByRole("button", { name })).toBeTruthy();
  });
});
