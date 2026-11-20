import { describe, expect, it } from "vitest";
import {
  captureApiEnvironment,
  isCaptureApiPolicy,
  matchesCaptureApiPolicy,
} from "./presentation-api-policy";

describe("presentation capture API policy", () => {
  for (const role of [
    "aggregate-D",
    "owning-527-baseline",
    "owning-527-modal-baseline",
    "owning-527-final",
  ]) {
    it(`${role} can use either a retired or a historical API`, () => {
      expect(matchesCaptureApiPolicy("retired", 404, null)).toBe(true);
      expect(matchesCaptureApiPolicy("legacy-enabled", 200, { orchestration_enabled: true })).toBe(
        true,
      );
      expect(
        matchesCaptureApiPolicy("legacy-disabled", 200, { orchestration_enabled: false }),
      ).toBe(true);
      expect(matchesCaptureApiPolicy("retired", 200, { orchestration_enabled: false })).toBe(false);
      expect(matchesCaptureApiPolicy("legacy-enabled", 404, null)).toBe(false);
      expect(matchesCaptureApiPolicy("legacy-enabled", 200, { orchestration_enabled: false })).toBe(
        false,
      );
    });
  }
  it("requires an explicit supported policy and sets the matching legacy environment", () => {
    expect(isCaptureApiPolicy(undefined)).toBe(false);
    expect(isCaptureApiPolicy("unknown")).toBe(false);
    expect(captureApiEnvironment("retired")).toEqual({});
    expect(captureApiEnvironment("legacy-enabled")).toEqual({ NAC_ORCHESTRATION: "1" });
    expect(captureApiEnvironment("legacy-disabled")).toEqual({ NAC_ORCHESTRATION: "0" });
  });
});
