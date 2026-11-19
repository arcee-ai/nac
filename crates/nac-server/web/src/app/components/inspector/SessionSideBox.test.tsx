/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionSideBox } from "@/app/components/inspector/SessionSideBox";
import { sessionLayoutStore } from "@/app/store/sessionLayoutStore";
import type { SessionSnapshotResponse } from "@/app/types/api";

const viewport = vi.hoisted(() => ({ mobile: false, tablet: false }));

vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => viewport.mobile,
  useIsTablet: () => viewport.tablet,
}));
vi.mock("@/app/hooks/useSessionFetching", () => ({ useSessionFetching: () => false }));
vi.mock("@/app/services/queries", () => ({
  useWorkspaceRevisionChanges: () => ({ data: null }),
  useWorkspaceRevisions: () => ({ data: [], isLoading: false, error: null }),
  useTraditionalChildren: () => ({ data: [] }),
}));
vi.mock("@/app/components/inspector/FilesView", () => ({ FilesView: () => <div>files</div> }));
vi.mock("@/app/components/inspector/DelegatedWorkView", () => ({
  DelegatedWorkView: () => <div>delegated</div>,
}));
vi.mock("@/app/components/inspector/HistoryView", () => ({
  HistoryView: () => <div>history</div>,
}));
vi.mock("@/app/components/inspector/RevisionPicker", () => ({
  RevisionPicker: () => <div>revision</div>,
}));
vi.mock("@/app/features/insights/presentation/InsightsView", () => ({
  InsightsView: ({ canSteerWorkers }: { canSteerWorkers: boolean }) => (
    <div data-testid="insights" data-can-steer={String(canSteerWorkers)}>
      insights
    </div>
  ),
}));
vi.mock("@/app/components/inspector/WorksetsView", () => ({
  WorksetsView: () => <div>worksets</div>,
}));

const snapshot = {
  metadata: { behavior: "direct" },
  lineage: null,
  workspace: null,
} as unknown as SessionSnapshotResponse;

beforeEach(() => {
  viewport.mobile = false;
  viewport.tablet = false;
  sessionLayoutStore.setState({ collapsed: false, expanded: false, panelList: false });
});

afterEach(cleanup);

describe("session side box tabs", () => {
  it("shows the behavior panels without a Sessions tab and heads the drawer with its controls", () => {
    const onPanelChange = vi.fn();
    const onClose = vi.fn();
    const onTogglePinned = vi.fn();
    render(
      <SessionSideBox
        sessionId="session-a"
        snapshot={snapshot}
        panel="files"
        onPanelChange={onPanelChange}
        onClose={onClose}
        onTogglePinned={onTogglePinned}
      />,
    );

    expect(screen.queryByRole("tab", { name: "Sessions" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Subagents" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("files")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Subagents" }));
    expect(onPanelChange).toHaveBeenCalledWith("delegated");
    fireEvent.click(screen.getByRole("button", { name: "Dock drawer" }));
    expect(onTogglePinned).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Full width" }));
    expect(sessionLayoutStore.getState().expanded).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves the phone body without the wide tab row", () => {
    viewport.mobile = true;
    render(
      <SessionSideBox
        sessionId="session-a"
        snapshot={snapshot}
        panel="files"
        onPanelChange={vi.fn()}
      />,
    );

    expect(screen.getByText("files")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide panel" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Sessions" })).toBeNull();
  });

  it("reactivates selected Insights on the tablet list while desktop selection stays stable", () => {
    const props = {
      sessionId: "session-a",
      snapshot,
      panel: "insights" as const,
      onPanelChange: vi.fn(),
    };
    const view = render(<SessionSideBox {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "Insights" }));
    expect(sessionLayoutStore.getState().panelList).toBe(false);
    viewport.tablet = true;
    view.rerender(<SessionSideBox {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "Insights" }));
    expect(sessionLayoutStore.getState().panelList).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(sessionLayoutStore.getState().panelList).toBe(false);
  });
});
