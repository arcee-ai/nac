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
  actions: { rename: vi.fn(), remove: vi.fn() },
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
vi.mock("@/app/features/ui-policy/UiPolicyContext", () => ({
  useUiPolicy: () => ({ orchestrationEnabled: false }),
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
    expanded: false,
    content: open === "goal" ? "goal" : "panel",
    panel: "insights",
    showing: (target) => target === open,
    toggle: vi.fn(),
    openPanel: vi.fn(),
    show: vi.fn(),
    close: vi.fn(),
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
  it("lists nothing for a wide session without a goal: its drawer tabs reach the panels", () => {
    const busy = facts({
      additions: 12,
      deletions: 3,
      agents: { count: 2, running: 1, panel: "delegated" },
      schedules: 1,
    });
    expect(sessionPanelEntries(busy, false)).toEqual([]);
  });

  it("lists only the goal on a wide screen, which has a drawer of its own", () => {
    expect(sessionPanelEntries(facts({ additions: 1, goal: goal("paused") }), false)).toEqual([
      "goal",
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

  it("lists only the goal with its state, then details and actions", () => {
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
    expect(within(menu).queryByRole("heading", { name: "Panels" })).toBeNull();
    for (const panel of ["Files", "Subagents", "Terminal", "Heartbeats", "Insights"])
      expect(within(menu).queryByRole("button", { name: new RegExp(`^${panel}`) })).toBeNull();
    expect(within(menu).getByRole("button", { name: /^Goal/ }).textContent).toBe("Goalpaused");
    expect(within(menu).getByText("ux/focus")).toBeTruthy();
    expect(within(menu).getByText("integrations")).toBeTruthy();
    expect(within(menu).getByText("usage readings")).toBeTruthy();
    for (const action of ["Fork from latest reply", "Rename", "Delete"])
      expect(within(menu).getByRole("button", { name: action })).toBeTruthy();
    expect(within(menu).queryByRole("button", { name: "Session settings" })).toBeNull();
  });

  it("opens the goal drawer and closes itself", () => {
    const controls = renderMenu(facts({ goal: goal("active") }), drawer("goal"));
    let menu = openMenu();
    const row = within(menu).getByRole("button", { name: /^Goal/ });
    expect(row.getAttribute("aria-current")).toBe("true");
    fireEvent.click(row);
    expect(controls.show).toHaveBeenCalledWith("goal");
    expect(screen.queryByRole("dialog", { name: "Session" })).toBeNull();

    menu = openMenu();
    fireEvent.click(within(menu).getByRole("button", { name: "Rename" }));
    expect(state.actions.rename).toHaveBeenCalledOnce();
  });

  it("is the phone header's Open panel sheet, listing every panel", () => {
    state.phone = true;
    renderMenu(facts());
    const sheet = openMenu("Open panel");
    for (const name of ["Files", "Subagents", "Terminal", "Heartbeats", "Insights", "History"])
      expect(within(sheet).getByRole("button", { name })).toBeTruthy();
  });
});
