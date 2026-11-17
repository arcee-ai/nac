import { describe, expect, it } from "vitest";

import {
  isGoalContinuationEnvelope,
  parseGoalContinuation,
} from "@/app/features/goals/continuation";
import { displayPromptFromMessageText } from "@/app/lib/format";

// The shared wire-format pin both sides test against: nac-core
// `commands/goal_continuation.rs` reads the same file.
import fixture from "../../../../../../../fixtures/goal-continuation-format.json";

describe("goal continuation shared fixture", () => {
  it("pins builder vectors", () => {
    expect(fixture.vectors.some((vector) => vector.prompt !== null)).toBe(true);
  });

  for (const vector of fixture.vectors) {
    it(`vector ${vector.name}`, () => {
      const parsed = parseGoalContinuation(vector.message);
      expect(parsed?.goalId ?? null).toBe(vector.goal_id);
      expect(parsed?.objective ?? null).toBe(vector.objective);
      expect(displayPromptFromMessageText(vector.message)).toBe(vector.display);
    });
  }

  it("never shows the control instructions for a recognized message", () => {
    for (const vector of fixture.vectors) {
      if (!isGoalContinuationEnvelope(vector.message)) continue;
      const display = displayPromptFromMessageText(vector.message);
      expect(display).not.toContain("get_goal");
      expect(display).not.toContain("Token budget");
      expect(display).not.toContain("nac_goal_continuation");
    }
  });
});
