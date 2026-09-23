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
      inspection: expect.stringMatching(/Threads and Worksets/i),
    });
    expect(sessionBehaviorPresentation("direct")).toMatchObject({
      navigationLabel: "Direct",
      topLevel: expect.stringMatching(/persistent coding agent/i),
      editsDirectly: true,
      delegation: expect.stringMatching(/fresh-context traditional coding agents/i),
      inspection: expect.stringMatching(/Delegated work/i),
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

  it("puts global sessions first while preserving every behavior-specific panel", () => {
    expect(sessionPanelPolicy("orchestrator", null)).toEqual({
      widePanels: ["sessions", "threads", "files", "worksets"],
      mobilePanels: ["sessions", "threads", "files", "worksets", "history"],
      defaultPanel: "sessions",
      readOnly: false,
    });
    for (const behavior of ["direct", "direct-with-orchestrator"] satisfies SessionBehavior[]) {
      expect(sessionPanelPolicy(behavior, null)).toEqual({
        widePanels: ["sessions", "delegated", "files"],
        mobilePanels: ["sessions", "delegated", "files", "history"],
        defaultPanel: "sessions",
        readOnly: false,
      });
    }
  });

  it("keeps traditional children read-only while retaining global navigation", () => {
    for (const behavior of behaviors) {
      expect(sessionPanelPolicy(behavior, "traditional-child")).toEqual({
        widePanels: ["sessions", "files"],
        mobilePanels: ["sessions", "files", "history"],
        defaultPanel: "sessions",
        readOnly: true,
      });
    }
  });

  it("gives managed orchestrators their own Threads and Worksets while remaining read-only", () => {
    for (const behavior of behaviors) {
      expect(sessionPanelPolicy(behavior, "managed-orchestrator")).toEqual({
        widePanels: ["sessions", "threads", "files", "worksets"],
        mobilePanels: ["sessions", "threads", "files", "worksets", "history"],
        defaultPanel: "sessions",
        readOnly: true,
      });
    }
  });

  it("preserves the legacy omitted-behavior default", () => {
    expect(sessionPanelPolicy(undefined, null)).toEqual(sessionPanelPolicy("orchestrator", null));
  });
});
