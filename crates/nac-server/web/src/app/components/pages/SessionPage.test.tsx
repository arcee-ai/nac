/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SessionPage from "@/app/components/pages/SessionPage";
import { sessionLayoutStore, selectInsight } from "@/app/store/sessionLayoutStore";
import type { SessionSnapshotResponse } from "@/app/types/api";

const fakes = vi.hoisted(() => ({ mobile: false, tablet: false, insightsMounts: 0 }));

vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => fakes.mobile,
  useIsTablet: () => fakes.tablet,
}));
vi.mock("@/app/hooks/useSessionFetching", () => ({ useSessionFetching: () => false }));
vi.mock("@/app/hooks/useSessionStream", () => ({
  useSessionStream: () => undefined,
  useRunStateSync: () => undefined,
}));
vi.mock("@/app/hooks/useErrorNotice", () => ({ useErrorNotice: () => () => null }));
vi.mock("@/app/providers/ProjectActionsProvider", () => ({
  useProjectActions: () => ({ newChat: vi.fn(), create: vi.fn() }),
}));
vi.mock("@/app/services/queries", () => ({
  useSessionSnapshot: () => ({ data: snapshot, error: null, refetch: vi.fn() }),
  useSessionSummary: () => ({ data: null }),
  useSshConnect: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useTraditionalChildren: () => ({ data: [] }),
  useManagedOrchestrators: () => ({ data: [] }),
}));
vi.mock("@/app/components/inspector/Transcript", () => ({
  Transcript: () => <div>transcript</div>,
}));
vi.mock("@/app/components/inspector/ChatInputBox", () => ({
  ChatInputBox: () => <textarea aria-label="Send a message" defaultValue="" />,
}));
vi.mock("@/app/components/inspector/TopSingleSessionHeader", () => ({
  TopSingleSessionHeader: () => <h1>session header</h1>,
}));
vi.mock("@/app/components/inspector/RightSidebarRail", () => ({
  RightSidebarRail: () => <div>rail</div>,
}));
vi.mock("@/app/components/inspector/transcript/TranscriptModelProvider", () => ({
  TranscriptModelProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/features/insights/InsightsNavigationProvider", () => ({
  InsightsNavigationProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/components/inspector/FilesView", () => ({ FilesView: () => <div>files</div> }));
vi.mock("@/app/components/inspector/DelegatedWorkView", () => ({
  DelegatedWorkView: () => <div>subagents</div>,
}));
vi.mock("@/app/features/terminal-selection/TerminalWorkspace", () => ({
  TerminalWorkspace: () => <div>terminal</div>,
}));
vi.mock("@/app/components/inspector/HistoryView", () => ({ HistoryView: () => null }));
vi.mock("@/app/components/inspector/WorksetsView", () => ({ WorksetsView: () => null }));
// Stands in for the Insights panel with state only a surviving instance keeps:
// a local pick, a scrolled list and a terminal-like field that owns Escape.
vi.mock("@/app/features/insights/presentation/InsightsView", () => ({
  InsightsView: function FakeInsights() {
    const [picked, setPicked] = useState("none");
    useEffect(() => {
      fakes.insightsMounts += 1;
    }, []);
    return (
      <div>
        <button type="button" onClick={() => setPicked("beta")}>
          Pick beta
        </button>
        <p>picked {picked}</p>
        <div data-testid="insights-list" style={{ overflow: "auto" }} />
        <div className="xterm">
          <textarea aria-label="Terminal input" />
        </div>
      </div>
    );
  },
}));

const snapshot = {
  metadata: { behavior: "direct", project_id: null },
  lineage: null,
  workspace: null,
  active_run: null,
} as unknown as SessionSnapshotResponse;

function mount() {
  return render(
    <MemoryRouter initialEntries={["/session/session-a/insights"]}>
      <Routes>
        <Route path="/session/:sessionId/:panel?" element={<SessionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const fullscreen = vi.fn();

beforeEach(() => {
  fakes.mobile = false;
  fakes.tablet = false;
  fakes.insightsMounts = 0;
  sessionLayoutStore.setState({ collapsed: false, expanded: false, sidePanelProjectId: null });
  fullscreen.mockReset();
  Object.assign(Element.prototype, { requestFullscreen: fullscreen });
});

afterEach(cleanup);

/** Picks a row in the panel's own state and the shared selection, and scrolls its list. */
function selectInSplit() {
  fireEvent.click(screen.getByRole("button", { name: "Pick beta" }));
  act(() => selectInsight({ kind: "group", groupId: "group-beta", segmentKey: null }));
  const list = screen.getByTestId("insights-list");
  list.scrollTop = 120;
  return list;
}

function expectSplitRestored(list: HTMLElement) {
  expect(screen.queryByRole("heading", { name: "Insights — focused" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Back to chat" })).toBeNull();
  expect(screen.getByRole("button", { name: "Focus panel" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Hide panel" })).toBeTruthy();
  expect(screen.getByText("session header").closest("[inert]")).toBeNull();
  const state = sessionLayoutStore.getState();
  expect(state.expanded).toBe(false);
  expect(state.collapsed).toBe(false);
  expect(state.selectedInsight).toEqual({ kind: "group", groupId: "group-beta", segmentKey: null });
  // The same panel instance, so its own pick and its scroll are where they were.
  expect(screen.getByText("picked beta")).toBeTruthy();
  expect(screen.getByTestId("insights-list")).toBe(list);
  expect(list.scrollTop).toBe(120);
  expect(fakes.insightsMounts).toBe(1);
  expect(fullscreen).not.toHaveBeenCalled();
}

describe("focused side panel", () => {
  it("focuses the panel in place, names it and offers Back to chat", () => {
    mount();
    const list = selectInSplit();

    const focus = screen.getByRole("button", { name: "Focus panel" });
    expect(screen.queryByRole("button", { name: "Expand panel" })).toBeNull();
    fireEvent.click(focus);

    expect(screen.getByRole("heading", { name: "Insights — focused" })).toBeTruthy();
    const back = screen.getByRole("button", { name: "Back to chat" });
    expect(document.activeElement).toBe(back);
    // Panel-only and in the page: no dialog, no browser fullscreen, the chat covered.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fullscreen).not.toHaveBeenCalled();
    expect(screen.getByText("session header").closest("[inert]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Focus panel" })).toBeNull();
    expect(screen.getByText("picked beta")).toBeTruthy();
    expect(screen.getByTestId("insights-list")).toBe(list);

    fireEvent.click(back);
    expectSplitRestored(list);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Focus panel" }));
  });

  it("goes back to the same split on Escape from inside the panel", () => {
    mount();
    const list = selectInSplit();
    fireEvent.click(screen.getByRole("button", { name: "Focus panel" }));

    // A terminal keeps Escape as its own input.
    const terminal = screen.getByRole("textbox", { name: "Terminal input" });
    terminal.focus();
    fireEvent.keyDown(terminal, { key: "Escape" });
    expect(screen.getByRole("heading", { name: "Insights — focused" })).toBeTruthy();

    // Escape outside the panel is not the panel's.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(sessionLayoutStore.getState().expanded).toBe(true);

    const back = screen.getByRole("button", { name: "Back to chat" });
    back.focus();
    fireEvent.keyDown(back, { key: "Escape" });
    expectSplitRestored(list);
  });

  it("shows a focused panel over the rail and goes back to the rail", () => {
    sessionLayoutStore.setState({ collapsed: true, expanded: true });
    mount();
    expect(screen.getByRole("heading", { name: "Insights — focused" })).toBeTruthy();
    expect(screen.getByText("rail").closest("[inert]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(sessionLayoutStore.getState()).toMatchObject({ expanded: false, collapsed: true });
    expect(screen.getByText("rail").closest("[inert]")).toBeNull();
  });

  it("leaves the focused panel when the session page goes away", () => {
    const { unmount } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Focus panel" }));
    expect(sessionLayoutStore.getState().expanded).toBe(true);
    unmount();
    expect(sessionLayoutStore.getState().expanded).toBe(false);
    expect(fullscreen).not.toHaveBeenCalled();
  });
});
