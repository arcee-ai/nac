/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SessionPage from "@/app/components/pages/SessionPage";
import { sessionLayoutStore, selectInsight } from "@/app/store/sessionLayoutStore";
import type { SessionSnapshotResponse } from "@/app/types/api";

const fakes = vi.hoisted(() => ({ mobile: false, dock: false, insightsMounts: 0 }));

vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => fakes.mobile,
  useIsTablet: () => false,
  useIsDesktop: () => !fakes.mobile,
  useMediaQuery: () => fakes.dock,
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
vi.mock("@/app/features/inbox/InboxProvider", () => ({ InboxReadMarker: () => null }));
vi.mock("@/app/components/inspector/Transcript", () => ({
  Transcript: () => <div>transcript</div>,
}));
vi.mock("@/app/components/inspector/ChatInputBox", () => ({
  ChatInputBox: () => <textarea aria-label="Send a message" defaultValue="" />,
}));
vi.mock("@/app/components/inspector/TopSingleSessionHeader", () => ({
  TopSingleSessionHeader: () => <h1>session header</h1>,
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
// a local pick and a scrolled list.
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
  fakes.dock = false;
  fakes.insightsMounts = 0;
  sessionLayoutStore.setState({
    collapsed: false,
    expanded: false,
    pinned: false,
    drawerContent: "panel",
    activeSessionId: null,
    sidePanelProjectId: null,
  });
  fullscreen.mockReset();
  Object.assign(Element.prototype, { requestFullscreen: fullscreen });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Picks a row in the panel's own state and the shared selection, and scrolls its list. */
function selectInDrawer() {
  fireEvent.click(screen.getByRole("button", { name: "Pick beta" }));
  act(() => selectInsight({ kind: "group", groupId: "group-beta", segmentKey: null }));
  const list = screen.getByTestId("insights-list");
  list.scrollTop = 120;
  return list;
}

/** The same panel instance, so its own pick and its scroll are where they were. */
function expectSamePanel(list: HTMLElement) {
  expect(sessionLayoutStore.getState().selectedInsight).toEqual({
    kind: "group",
    groupId: "group-beta",
    segmentKey: null,
  });
  expect(screen.getByText("picked beta")).toBeTruthy();
  expect(screen.getByTestId("insights-list")).toBe(list);
  expect(list.scrollTop).toBe(120);
  expect(fakes.insightsMounts).toBe(1);
  expect(fullscreen).not.toHaveBeenCalled();
}

describe("full-width session drawer", () => {
  it("fills the window and goes back without remounting the panel", () => {
    mount();
    const list = selectInDrawer();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Full width" }));
    const exit = screen.getByRole("button", { name: "Exit full width" });
    expect(exit.getAttribute("aria-pressed")).toBe("true");
    expect(sessionLayoutStore.getState()).toMatchObject({ expanded: true, collapsed: false });
    // The one drawer widens; it is not a second surface or browser fullscreen.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expectSamePanel(list);

    fireEvent.click(exit);
    expect(screen.getByRole("button", { name: "Full width" })).toBeTruthy();
    expect(sessionLayoutStore.getState()).toMatchObject({ expanded: false, collapsed: false });
    expectSamePanel(list);
  });

  it("expands the dock and restores the same panel beside the chat", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1400);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    fakes.dock = true;
    sessionLayoutStore.setState({ pinned: true });
    mount();
    expect(screen.getByRole("button", { name: "Float drawer" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    const list = selectInDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Full width" }));
    expect(screen.getByRole("button", { name: "Exit full width" })).toBeTruthy();
    expectSamePanel(list);
    fireEvent.click(screen.getByRole("button", { name: "Exit full width" }));
    expectSamePanel(list);
  });

  it("leaves full width when the session page goes away", () => {
    const { unmount } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Full width" }));
    expect(sessionLayoutStore.getState().expanded).toBe(true);
    unmount();
    expect(sessionLayoutStore.getState().expanded).toBe(false);
    expect(fullscreen).not.toHaveBeenCalled();
  });
});
