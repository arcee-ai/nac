import { describe, expect, it } from "vitest";
import {
  SESSION_BEHAVIORS,
  sessionBehaviorPresentation,
  sessionPanelPolicy,
} from "@/app/lib/sessionBehavior";

describe("direct session presentation", () => {
  it("presents one direct coding agent with child sessions", () => {
    expect(SESSION_BEHAVIORS.map((behavior) => behavior.id)).toEqual(["direct"]);
    expect(sessionBehaviorPresentation("direct")).toMatchObject({
      navigationLabel: "Agent",
      editsDirectly: true,
      topLevel: expect.stringMatching(/persistent coding agent/i),
      delegation: expect.stringMatching(/child coding agents/i),
    });
  });
  it("shows primary session panels and keeps child transcripts read-only", () => {
    expect(sessionPanelPolicy("direct", null)).toEqual({
      widePanels: ["insights", "delegated", "files", "terminal", "heartbeats"],
      mobilePanels: ["insights", "delegated", "files", "terminal", "history", "heartbeats"],
      defaultPanel: "insights",
      readOnly: false,
    });
    expect(sessionPanelPolicy("direct", "traditional-child")).toEqual({
      widePanels: ["insights", "files"],
      mobilePanels: ["insights", "files", "history"],
      defaultPanel: "insights",
      readOnly: true,
    });
  });
});
