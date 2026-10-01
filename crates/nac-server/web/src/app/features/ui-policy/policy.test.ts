import { describe, expect, it } from "vitest";
import {
  creationBehavior,
  DIRECT_UI_POLICY,
  ORCHESTRATION_UI_POLICY,
  sessionAvailable,
  visibleSessions,
  firstChatAdmission,
} from "./policy";
import { sessionPanelPolicy } from "@/app/lib/sessionBehavior";
import type { ManagedSessionSummary, SessionBehavior, SessionLineage } from "@/app/types/api";

function entry(behavior: SessionBehavior, kind?: SessionLineage["kind"]): ManagedSessionSummary {
  return {
    summary: { session_id: behavior + (kind ?? ""), project_id: "p", behavior },
    lineage: kind ? { kind } : null,
  } as ManagedSessionSummary;
}

describe("runtime presentation policy", () => {
  it("always explicitly creates direct while opt-in keeps every selected behavior", () => {
    for (const behavior of ["direct", "orchestrator", "direct-with-orchestrator"] as const) {
      expect(creationBehavior(DIRECT_UI_POLICY, behavior)).toBe("direct");
      expect(creationBehavior(ORCHESTRATION_UI_POLICY, behavior)).toBe(behavior);
    }
  });
  it("filters immutable legacy and managed identities while retaining traditional children", () => {
    const sessions = [
      entry("orchestrator"),
      entry("direct"),
      entry("direct-with-orchestrator"),
      entry("orchestrator", "managed-orchestrator"),
      entry("direct", "traditional-child"),
    ];
    expect(visibleSessions(DIRECT_UI_POLICY, sessions)).toEqual([sessions[1], sessions[4]]);
    expect(visibleSessions(ORCHESTRATION_UI_POLICY, sessions)).toEqual(sessions);
    expect(sessions[0].summary.behavior).toBe("orchestrator");
    expect(sessionAvailable(DIRECT_UI_POLICY, undefined, null)).toBe(false);
    expect(sessionPanelPolicy("direct", "traditional-child")).toMatchObject({
      readOnly: true,
      mobilePanels: ["files", "history"],
    });
  });
  it("uses normal creation for legacy-only projects, preserving empty admission and mixed redirect", () => {
    expect(firstChatAdmission(DIRECT_UI_POLICY, [], "p")).toBe(true);
    expect(firstChatAdmission(DIRECT_UI_POLICY, [entry("orchestrator")], "p")).toBe(false);
    expect(firstChatAdmission(ORCHESTRATION_UI_POLICY, [entry("orchestrator")], "p")).toBe(true);
    expect(
      visibleSessions(DIRECT_UI_POLICY, [entry("orchestrator"), entry("direct")]),
    ).toHaveLength(1);
  });
});
