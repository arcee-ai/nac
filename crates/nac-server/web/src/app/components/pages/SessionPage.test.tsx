/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SessionPage from "@/app/components/pages/SessionPage";
import { sessionLayoutStore } from "@/app/store/sessionLayoutStore";
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

describe("session drawer", () => {
  it("floats where there is no room to dock, with no float or full-width control", () => {
    mount();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^(Dock|Float) drawer$|full width/i })).toBeNull();
  });

  it("docks beside the chat wherever there is room, with no float or full-width control", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1400);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    fakes.dock = true;
    mount();
    expect(screen.getByRole("complementary")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Dock|Float) drawer$|full width/i })).toBeNull();
  });
});
