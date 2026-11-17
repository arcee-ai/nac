import { describe, expect, it } from "vitest";

import type { InsightSegment, ModelTurnItem } from "@/app/features/insights/model/types";

import { formatWorkDuration, layoutModelTurn, settledFoldLabel, workSentence } from "./foldLayout";
import { liveStepLabel } from "./stepLabels";

function tool(
  key: string,
  name: string,
  action: Extract<InsightSegment, { kind: "tool" }>["action"],
  summary: string,
  status: "success" | "error" | "running" | "awaiting-approval" = "success",
): InsightSegment {
  return {
    kind: "tool",
    key,
    name,
    action,
    pending: status === "running",
    presentation: {
      callId: key,
      name,
      label: name,
      summary,
      resultPreview: null,
      status,
      statusLabel: status,
    },
  };
}

const read = (key: string, path: string) => tool(key, "read", "read-file", path);
const run = (key: string, cmd: string) => tool(key, "exec_command", "run-command", cmd);

describe("work fold sentence", () => {
  it("counts files once and names intents in a fixed order", () => {
    const segments = [
      read("a", "src/a.ts"),
      read("b", "src/a.ts"),
      read("c", "src/b.ts"),
      run("d", "npm test"),
      run("e", "npm run lint"),
    ];
    expect(workSentence(segments)).toBe("Read 2 files, ran 2 commands");
    expect(settledFoldLabel(segments, 72_400)).toBe(
      "Worked for 1m 12s · Read 2 files, ran 2 commands",
    );
  });

  it("says a turn that only reasoned thought for its duration", () => {
    const thought: InsightSegment = {
      kind: "reasoning",
      key: "t",
      text: "hm",
      durationMs: 4_200,
      streaming: false,
    };
    expect(settledFoldLabel([thought], null)).toBe("Thought for 4.2s");
  });

  it("formats durations compactly", () => {
    expect(formatWorkDuration(400)).toBe("<1s");
    expect(formatWorkDuration(12_300)).toBe("12s");
    expect(formatWorkDuration(3_723_000)).toBe("1h 2m");
  });
});

describe("work fold layout", () => {
  it("folds groups and the prose between them, keeping the answer and sessions in the open", () => {
    const group = (id: string, segment: InsightSegment): ModelTurnItem => ({
      kind: "group",
      id,
      group: { id, segments: [segment], status: "ready", durationMs: null },
    });
    const text = (key: string, value: string): ModelTurnItem => ({
      kind: "block",
      block: { kind: "text", key, text: value },
    });
    const layout = layoutModelTurn([
      group("g1", read("a", "src/a.ts")),
      text("t1", "Let me run the tests."),
      group("g2", run("b", "npm test")),
      text("t2", "All green."),
    ]);
    expect(layout.map((entry) => entry.kind)).toEqual(["fold", "block"]);
    const fold = layout[0];
    if (fold.kind !== "fold") throw new Error("expected a fold first");
    expect(fold.groupIds).toEqual(["g1", "g2"]);
    expect(fold.steps.map((step) => step.kind)).toEqual(["segment", "note", "segment"]);
  });

  it("leaves a turn without work untouched", () => {
    const layout = layoutModelTurn([
      { kind: "block", block: { kind: "text", key: "t", text: "Hello" } },
    ]);
    expect(layout).toEqual([
      { kind: "block", key: "t", block: { kind: "text", key: "t", text: "Hello" } },
    ]);
  });
});

describe("live status line", () => {
  it("names the running step, the approval it waits on, or thinking between steps", () => {
    expect(liveStepLabel(tool("a", "exec_command", "run-command", "npm test", "running"))).toBe(
      "Running npm test…",
    );
    expect(liveStepLabel(tool("a", "write", "write-file", "src/a.ts", "awaiting-approval"))).toBe(
      "Waiting for approval…",
    );
    expect(liveStepLabel(read("a", "src/a.ts"))).toBe("Thinking…");
    expect(liveStepLabel(undefined)).toBe("Thinking…");
  });
});
