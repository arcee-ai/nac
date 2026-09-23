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
}));
vi.mock("@/app/components/sessions/SessionCollection", () => ({
  SessionCollection: () => <nav aria-label="All sessions">collection</nav>,
}));
vi.mock("@/app/components/inspector/FilesView", () => ({ FilesView: () => <div>files</div> }));
vi.mock("@/app/components/inspector/DelegatedWorkView", () => ({
  DelegatedWorkView: () => <div>delegated</div>,
}));
vi.mock("@/app/components/inspector/HistoryView", () => ({
  HistoryView: () => <div>history</div>,
}));
vi.mock("@/app/components/inspector/ThreadsView", () => ({
  ThreadsView: () => <div>threads</div>,
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

describe("session side box collection integration", () => {
  it("shows Sessions by default beside preserved views and uses the existing collapse control", () => {
    const onPanelChange = vi.fn();
    render(
      <SessionSideBox
        sessionId="session-a"
        snapshot={snapshot}
        panel="sessions"
        onPanelChange={onPanelChange}
        sessions={[]}
        projects={[]}
      />,
    );

    expect(screen.getByRole("navigation", { name: "All sessions" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sessions" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("tab", { name: "Delegated work" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Files" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));
    expect(sessionLayoutStore.getState().collapsed).toBe(true);
  });

  it("leaves the collection body to the existing phone sheet chrome", () => {
    viewport.mobile = true;
    render(
      <SessionSideBox
        sessionId="session-a"
        snapshot={snapshot}
        panel="sessions"
        onPanelChange={vi.fn()}
        sessions={[]}
        projects={[]}
      />,
    );

    expect(screen.getByRole("navigation", { name: "All sessions" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide panel" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Sessions" })).toBeNull();
  });
});
