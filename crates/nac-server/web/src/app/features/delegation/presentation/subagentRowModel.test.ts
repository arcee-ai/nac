import { describe, expect, it } from "vitest";

import { compactAge, subagentDotStatus, subagentStateLine } from "./subagentRowModel";

describe("subagent row model", () => {
  it("maps delegated lifecycles onto the shared status ladder", () => {
    expect(subagentDotStatus("running")).toBe("working");
    expect(subagentDotStatus("failed")).toBe("failed");
    expect(subagentDotStatus("interrupted")).toBe("failed");
    expect(subagentDotStatus("completed")).toBe("done");
    expect(subagentDotStatus("cancelled")).toBe("idle");
    expect(subagentDotStatus("idle")).toBe("idle");
  });

  it("names the kind, the state and the latest word in one line", () => {
    expect(
      subagentStateLine({
        status: "completed",
        orchestrator: false,
        background: true,
        detail: "\nAll checks passed.\nSecond line",
      }),
    ).toBe("Done · All checks passed.");
    expect(
      subagentStateLine({ status: "running", orchestrator: true, background: true, detail: "x" }),
    ).toBe("Orchestrator · Working · background");
  });

  it("formats how long ago a record changed", () => {
    const now = Date.parse("2026-01-02T12:00:00Z");
    expect(compactAge("2026-01-02 11:59:40", now)).toBe("now");
    expect(compactAge("2026-01-02 11:55:00", now)).toBe("5m");
    expect(compactAge("2026-01-02 09:00:00", now)).toBe("3h");
    expect(compactAge("2025-12-30 12:00:00", now)).toBe("3d");
    expect(compactAge("not a time", now)).toBe("");
  });
});
