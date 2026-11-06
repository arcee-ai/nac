import { describe, expect, it } from "vitest";

import {
  SESSION_BEHAVIORS,
  sessionBehaviorPresentation,
  sessionPanelPolicy,
} from "@/app/lib/sessionBehavior";
import type { SessionBehavior } from "@/app/types/api";

describe("session behavior presentation", () => {
  it("keeps one complete, immutable presentation model for all three public values", () => {
    expect(SESSION_BEHAVIORS.map((behavior) => behavior.id)).toEqual([
      "orchestrator",
      "direct",
      "direct-with-orchestrator",
    ]);

    expect(sessionBehaviorPresentation("orchestrator")).toMatchObject({
      navigationLabel: "Orchestrator",
      topLevel: expect.stringMatching(/planner/i),
      editsDirectly: false,
      delegation: expect.stringMatching(/retained NAC worker threads/i),
      inspection: expect.stringMatching(/Insights and Worksets/i),
    });
    expect(sessionBehaviorPresentation("direct")).toMatchObject({
      navigationLabel: "Direct",
      topLevel: expect.stringMatching(/persistent coding agent/i),
      editsDirectly: true,
      delegation: expect.stringMatching(/fresh-context traditional coding agents/i),
      inspection: expect.stringMatching(/Subagents/i),
    });
    expect(sessionBehaviorPresentation("direct-with-orchestrator")).toMatchObject({
      navigationLabel: "Direct + NAC",
      topLevel: expect.stringMatching(/persistent coding agent/i),
      editsDirectly: true,
      delegation: expect.stringMatching(/separate NAC orchestrator sessions/i),
      inspection: expect.stringMatching(/both delegated topologies/i),
    });
  });
});

describe("session panel policy", () => {
  const behaviors: SessionBehavior[] = ["orchestrator", "direct", "direct-with-orchestrator"];

  it("keeps every behavior-specific panel and leaves session switching to the sidebar", () => {
    expect(sessionPanelPolicy("orchestrator", null)).toEqual({
      widePanels: ["insights", "files", "worksets"],
      mobilePanels: ["insights", "files", "worksets", "history"],
      defaultPanel: "insights",
      readOnly: false,
    });
    for (const behavior of ["direct", "direct-with-orchestrator"] satisfies SessionBehavior[]) {
      expect(sessionPanelPolicy(behavior, null)).toEqual({
        widePanels: [
          "insights",
          "delegated",
          "files",
          "terminal",
          ...(behavior === "direct" ? ["heartbeats"] : []),
        ],
        mobilePanels: [
          "insights",
          "delegated",
          "files",
          "terminal",
          "history",
          ...(behavior === "direct" ? ["heartbeats"] : []),
        ],
        defaultPanel: "insights",
        readOnly: false,
      });
    }
  });

  it("keeps traditional children read-only with Insights and Files only", () => {
    for (const behavior of behaviors) {
      expect(sessionPanelPolicy(behavior, "traditional-child")).toEqual({
        widePanels: ["insights", "files"],
        mobilePanels: ["insights", "files", "history"],
        defaultPanel: "insights",
        readOnly: true,
      });
    }
  });

  it("gives managed orchestrators their own Insights and Worksets while remaining read-only", () => {
    for (const behavior of behaviors) {
      expect(sessionPanelPolicy(behavior, "managed-orchestrator")).toEqual({
        widePanels: ["insights", "files", "worksets"],
        mobilePanels: ["insights", "files", "worksets", "history"],
        defaultPanel: "insights",
        readOnly: true,
      });
    }
  });

  it("preserves the legacy omitted-behavior default", () => {
    expect(sessionPanelPolicy(undefined, null)).toEqual(sessionPanelPolicy("orchestrator", null));
  });
});
