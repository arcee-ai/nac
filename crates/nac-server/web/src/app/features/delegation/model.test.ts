import { describe, expect, it } from "vitest";

import {
  presentManagedOrchestrator,
  presentTraditionalChild,
} from "@/app/features/delegation/model";
import type { ManagedOrchestratorRecord, TraditionalChildRecord } from "@/app/types/api";

const base = {
  parent_session_id: "parent",
  root_session_id: "parent",
  description: "Audit durability",
  status: "idle" as const,
  generation: 2,
  run_id: null,
  execution_mode: null,
  report: null,
  failure: null,
  completion_inbox_id: null,
  created_at: "2026-08-28T10:00:00Z",
  updated_at: "2026-08-28T11:00:00Z",
  version: 1,
};

function child(overrides: Partial<TraditionalChildRecord> = {}): TraditionalChildRecord {
  return {
    ...base,
    child_session_id: "child-1",
    profile: "general",
    nesting_depth: 1,
    change_summary: null,
    verification_summary: null,
    ...overrides,
  };
}

function orchestrator(
  overrides: Partial<ManagedOrchestratorRecord> = {},
): ManagedOrchestratorRecord {
  return { ...base, orchestrator_session_id: "orch-1", ...overrides };
}

describe("delegated-session presentation", () => {
  it.each(["idle", "running", "completed", "failed", "cancelled", "interrupted"] as const)(
    "maps the %s lifecycle into text and actions",
    (status) => {
      const view = presentTraditionalChild(child({ status }));
      expect(view.statusLabel.toLowerCase()).toBe(status);
      expect(view.canSteer).toBe(status === "running");
      expect(view.canCancel).toBe(status === "running");
      expect(view.canContinue).toBe(status !== "running");
    },
  );

  it("keeps topology, generation, mode, update time, and completion attention explicit", () => {
    const coding = presentTraditionalChild(
      child({ status: "completed", execution_mode: "background", completion_inbox_id: 4 }),
    );
    const managed = presentManagedOrchestrator(
      orchestrator({ status: "running", execution_mode: "foreground" }),
    );
    expect(coding).toMatchObject({
      kind: "coding-agent",
      typeLabel: "Coding agent",
      generation: 2,
      modeLabel: "Background",
      completionNeedsAttention: true,
    });
    expect(coding.updatedLabel).not.toBe("");
    expect(managed).toMatchObject({
      kind: "nac-orchestrator",
      typeLabel: "NAC orchestrator",
      modeLabel: "Foreground",
      completionNeedsAttention: false,
    });
  });

  it("uses failure before report and child summaries without losing long text", () => {
    const long = "verified ".repeat(80).trim();
    expect(presentTraditionalChild(child({ report: "report", failure: "failure" }))).toMatchObject({
      outcomeLabel: "Error",
      outcome: "failure",
    });
    expect(presentTraditionalChild(child({ verification_summary: long }))).toMatchObject({
      outcomeLabel: "Verification",
      outcome: long,
    });
    expect(presentManagedOrchestrator(orchestrator({ report: "done" }))).toMatchObject({
      outcomeLabel: "Outcome",
      outcome: "done",
    });
  });
});
