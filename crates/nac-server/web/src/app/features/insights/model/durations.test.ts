import { describe, expect, it } from "vitest";

import {
  formatBadgeDuration,
  formatListDuration,
  segmentDurationMs,
  sumSegmentDurations,
} from "@/app/features/insights/model/durations";
import { presentation } from "@/app/features/insights/model/fixtures.test-support";
import type { InsightSegment } from "@/app/features/insights/model/types";
import type { ToolPresentation } from "@/app/lib/toolPresentation";

function reasoning(durationMs: number | null): InsightSegment {
  return { kind: "reasoning", key: "thoughts-0", text: "Thinking", durationMs, streaming: false };
}

function tool(overrides: Partial<ToolPresentation> | null): InsightSegment {
  return {
    kind: "tool",
    key: "tool-call-exec_command",
    name: "exec_command",
    action: "run-command",
    presentation: overrides ? presentation("exec_command", overrides) : null,
    pending: false,
  };
}

describe("segment durations", () => {
  it("reads reasoning and tool durations and never invents one", () => {
    expect(segmentDurationMs(reasoning(800))).toBe(800);
    expect(segmentDurationMs(reasoning(null))).toBeNull();
    expect(segmentDurationMs(tool({ status: "timed-out", durationMs: 30_000 }))).toBe(30_000);
    expect(segmentDurationMs(tool({}))).toBeNull();
    expect(segmentDurationMs(tool(null))).toBeNull();
    expect(
      segmentDurationMs({
        kind: "workset",
        key: "workset_define-1-0",
        worksetId: "w",
        pending: false,
      }),
    ).toBeNull();
  });

  it("sums only when every duration is known", () => {
    expect(sumSegmentDurations([reasoning(800), tool({ durationMs: 200 })])).toBe(1_000);
    expect(sumSegmentDurations([reasoning(800), tool({})])).toBeNull();
    expect(sumSegmentDurations([reasoning(null), tool({ durationMs: 200 })])).toBeNull();
    expect(sumSegmentDurations([reasoning(0)])).toBe(0);
    expect(sumSegmentDurations([])).toBeNull();
  });

  it("formats tenths of a second like the Figma samples", () => {
    expect(formatListDuration(13_750)).toBe("13.8 s");
    expect(formatListDuration(125_000)).toBe("125.0 s");
    expect(formatBadgeDuration(12_324)).toBe("12.3s");
    expect(formatBadgeDuration(49)).toBe("0.0s");
    expect(formatBadgeDuration(-5)).toBe("0.0s");
  });
});
