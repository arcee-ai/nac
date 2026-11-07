import { describe, expect, it } from "vitest";

import { createSessionLayoutStore } from "@/app/store/sessionLayoutStore";

const picked = { kind: "group", groupId: "parent-action", segmentKey: "spawn" } as const;

describe("inspector return context", () => {
  it("restores a captured filter, segment, expansion and list without following later selections", () => {
    const layout = createSessionLayoutStore();
    layout.activateSessionSelection("parent");
    layout.selectInsightsFilter("tools");
    layout.toggleInsightGroup("parent-action", true);
    layout.showSidePanelList(true);
    layout.rememberInsightListPosition("parent", 248);
    layout.rememberInsightsReturn("parent", picked);
    layout.selectSubagent("parent", "child:one");
    // Replaced data or another surface's picks do not write the origin.
    layout.selectInsight({ kind: "group", groupId: "new-action", segmentKey: null });
    layout.selectInsightsFilter("all");
    layout.toggleInsightGroup("parent-action", false);
    layout.showSidePanelList(false);

    expect(layout.restoreInsightsReturn("parent")).toBe(true);
    expect(layout.sessionLayoutStore.getState()).toMatchObject({
      selectedInsight: picked,
      insightsFilter: "tools",
      panelList: true,
      expandedInsightGroups: new Set(["parent-action"]),
    });
    expect(layout.sessionLayoutStore.getState().insightListPositions.get("parent")?.top).toBe(248);
    expect(layout.restoreInsightsReturn("parent")).toBe(false);
  });

  it("restores the exact parent panel after opening the child's own page, even via browser back", () => {
    const layout = createSessionLayoutStore();
    layout.activateSessionSelection("parent");
    layout.revealSidePanel(true);
    layout.selectSubagent("parent", "child:two");
    layout.selectThread("worker", "episode-2");
    layout.selectInsight({ kind: "thread" });
    layout.rememberInsightsReturn(
      "parent",
      { kind: "thread" },
      { name: "worker", episode: "episode-2" },
    );
    layout.rememberInsightListPosition("parent", 248, {
      key: "thread:worker:episode-2",
      offset: 52,
    });
    layout.rememberSubagentPage("parent", "two");
    layout.toggleSidePanelExpanded();
    layout.activateSessionSelection("two");
    layout.selectInsight({ kind: "group", groupId: "child-action", segmentKey: null });
    layout.activateSessionSelection("two"); // Refetch/route changes within the child are inert.
    layout.activateSessionSelection("parent");

    expect(layout.sessionLayoutStore.getState()).toMatchObject({
      expanded: true,
      selectedInsight: { kind: "thread" },
      selectedThread: "worker",
      selectedThreadEpisode: "episode-2",
    });
    expect(layout.sessionLayoutStore.getState().selectedSubagents.get("parent")).toBe("child:two");
    expect(layout.restoreInsightsReturn("parent")).toBe(true);
    expect(layout.sessionLayoutStore.getState().insightSelectionEpoch).toBe(
      layout.sessionLayoutStore.getState().insightListPositions.get("parent")?.sourceEpoch,
    );
  });

  it("fences restoration by exact parent and runtime, and releases all retained origins", () => {
    const first = createSessionLayoutStore();
    const second = createSessionLayoutStore();
    first.activateSessionSelection("parent");
    first.selectInsight(picked);
    first.rememberInsightsReturn("parent", picked);
    first.rememberSubagentPage("parent", "child");
    first.activateSessionSelection("child");
    first.activateSessionSelection("other-parent");
    expect(first.sessionLayoutStore.getState().selectedInsight).toBeNull();
    expect(first.restoreInsightsReturn("other-parent")).toBe(false);
    expect(second.restoreInsightsReturn("parent")).toBe(false);
    second.activateSessionSelection("child");
    second.activateSessionSelection("parent");
    expect(second.sessionLayoutStore.getState().selectedInsight).toBeNull();
    first.release();
    expect(first.restoreInsightsReturn("parent")).toBe(false);
    expect(first.sessionLayoutStore.getState().subagentPageReturns.size).toBe(0);
    expect(first.sessionLayoutStore.getState().insightListPositions.size).toBe(0);
  });
});
