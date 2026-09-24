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
vi.mock("@/app/components/inspector/ThreadsView", () => ({
  ThreadsView: ({ canSteerWorkers }: { canSteerWorkers: boolean }) => (
    <div data-testid="threads" data-can-steer={String(canSteerWorkers)}>
      threads
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
  sessionLayoutStore.setState({ collapsed: false, expanded: false });
});

afterEach(cleanup);

describe("session side box tabs", () => {
  it("shows the behavior panels without a Sessions tab and keeps the collapse control", () => {
    const onPanelChange = vi.fn();
    render(
      <SessionSideBox
        sessionId="session-a"
        snapshot={snapshot}
        panel="files"
        onPanelChange={onPanelChange}
      />,
    );

    expect(screen.queryByRole("tab", { name: "Sessions" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Delegated work" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("files")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));
    expect(sessionLayoutStore.getState().collapsed).toBe(true);
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
    expect(screen.queryByRole("tab", { name: "Sessions" })).toBeNull();
  });

  it("grants worker steering only to a primary classic orchestrator", () => {
    const classic = {
      ...snapshot,
      metadata: { ...snapshot.metadata, behavior: "orchestrator" },
      lineage: null,
    } as SessionSnapshotResponse;
    const managed = {
      ...classic,
      lineage: { kind: "managed-orchestrator" },
    } as unknown as SessionSnapshotResponse;
    const props = {
      sessionId: "session-a",
      panel: "threads" as const,
      onPanelChange: vi.fn(),
      sessions: [],
      projects: [],
    };

    const { rerender } = render(<SessionSideBox {...props} snapshot={classic} />);
    expect(screen.getByTestId("threads").getAttribute("data-can-steer")).toBe("true");

    rerender(<SessionSideBox {...props} snapshot={managed} />);
    expect(screen.getByTestId("threads").getAttribute("data-can-steer")).toBe("false");
  });
});
