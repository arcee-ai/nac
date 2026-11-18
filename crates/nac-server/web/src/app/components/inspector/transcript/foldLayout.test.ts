import { describe, expect, it } from "vitest";

import type { InsightSegment, ModelTurnItem } from "@/app/features/insights/model/types";

import { formatWorkDuration, layoutModelTurn, settledFoldLabel, workSentence } from "./foldLayout";
import { liveStepLabel, liveTurnLabel, stepLabel } from "./stepLabels";

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
  it("groups only adjacent resolved calls to the same child within one turn", () => {
    const session = (id: string, rowKey: `child:${string}` | null): ModelTurnItem => ({
      kind: "session",
      id,
      action: "spawn-agent",
      rowKey,
      title: "Audit",
      status: "ready",
      presentation: {
        callId: id,
        name: "subagent",
        label: "Subagent",
        summary: null,
        resultPreview: null,
        status: "success",
        statusLabel: "Succeeded",
      },
    });
    const a = session("a", "child:one");
    const b = session("b", "child:one");
    const text: ModelTurnItem = {
      kind: "block",
      block: { kind: "text", key: "note", text: "Between" },
    };
    const c = session("c", "child:one");
    const other = session("other", "child:two");
    const unknown = session("unknown", null);
    const layout = layoutModelTurn([a, b, text, c, other, unknown]);
    expect(layout.map((item) => item.kind)).toEqual([
      "session-group",
      "block",
      "session",
      "session",
      "session",
    ]);
    expect(layout[0]).toMatchObject({ kind: "session-group", entries: [a, b] });
    expect(layout[2]).toEqual(c);
  });

  it("keeps the fold key when an Insights group receives its canonical prompt anchor", () => {
    const group = (id: string): ModelTurnItem => ({
      kind: "group",
      id,
      group: {
        id,
        segments: [read("read-0", "a.ts")],
        status: "ready",
        durationMs: null,
      },
    });
    const live = layoutModelTurn([group("insights-leading:read-0")])[0];
    const settled = layoutModelTurn([group("user-2:read-0")])[0];
    expect(live.kind).toBe("fold");
    expect(settled.kind).toBe("fold");
    if (live.kind === "fold" && settled.kind === "fold") expect(live.key).toBe(settled.key);
  });

  it("keeps prose in place between activity folds", () => {
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
    expect(layout.map((entry) => entry.kind)).toEqual(["fold", "block", "fold", "block"]);
    const fold = layout[0];
    if (fold.kind !== "fold") throw new Error("expected a fold first");
    expect(fold.groupIds).toEqual(["g1"]);
    expect(fold.steps.map((step) => step.kind)).toEqual(["segment"]);
  });

  it("leaves a turn without work untouched", () => {
    const layout = layoutModelTurn([
      { kind: "block", block: { kind: "text", key: "t", text: "Hello" } },
    ]);
    expect(layout).toEqual([
      {
        kind: "block",
        key: "t",
        block: { kind: "text", key: "t", text: "Hello" },
      },
    ]);
  });

  it("keeps activity after a thread wave after that wave", () => {
    const group = (id: string, segment: InsightSegment): ModelTurnItem => ({
      kind: "group",
      id,
      group: { id, segments: [segment], status: "ready", durationMs: null },
    });
    const layout = layoutModelTurn([
      group("first", read("a", "a.ts")),
      { kind: "block", block: { kind: "wave", key: "wave", rows: [] } },
      group("second", run("b", "npm test")),
    ]);
    expect(layout.map((entry) => entry.kind)).toEqual(["fold", "block", "fold"]);
  });

  it("does not label prose before a wave as thought because work follows the wave", () => {
    const layout = layoutModelTurn([
      {
        kind: "block",
        block: { kind: "text", key: "note", text: "Starting a thread." },
      },
      { kind: "block", block: { kind: "wave", key: "wave", rows: [] } },
      {
        kind: "group",
        id: "later",
        group: {
          id: "later",
          segments: [read("read", "a.ts")],
          status: "ready",
          durationMs: null,
        },
      },
    ]);
    expect(layout.map((entry) => entry.kind)).toEqual(["block", "block", "fold"]);
  });
});

describe("live status line", () => {
  it("uses validated intent for a partitioned subagent session", () => {
    const segment = tool("child", "subagent", "spawn-agent", "Review store", "running");
    if (segment.kind !== "tool" || !segment.presentation) throw new Error("expected tool");
    const session: ModelTurnItem = {
      kind: "session",
      id: "child",
      action: "spawn-agent",
      rowKey: null,
      title: "Review store",
      status: "running",
      presentation: segment.presentation,
    };
    session.presentation.label = "Subagent request in progress";
    expect(liveTurnLabel([session])).toBe("Subagent request in progress");
    session.presentation.label = "Starting subagent…";
    expect(liveTurnLabel([session])).toBe("Starting subagent…");
    session.status = "pending";
    expect(liveTurnLabel([session])).toBe("Waiting for approval…");
  });

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

describe("subagent work rows", () => {
  it("uses the invocation's evidence-aware label and keeps the task summary", () => {
    const segment = tool("child", "subagent", "spawn-agent", "Review store");
    if (segment.kind !== "tool" || !segment.presentation) throw new Error("expected tool");
    segment.presentation.label = "Instructions sent to subagent";
    expect(stepLabel(segment)).toMatchObject({
      verb: "Instructions sent to subagent",
      argument: "Review store",
    });
    expect(workSentence([segment])).toBe("Made 1 subagent request");
    segment.presentation.label = "Subagent started";
    segment.presentation.delegationOutcome = "background_started";
    expect(workSentence([segment])).toBe("Started 1 subagent");
    segment.presentation.label = "Subagent request failed";
    segment.presentation.status = "error";
    expect(stepLabel(segment)).toMatchObject({ verb: "Subagent request failed", status: "failed" });
  });
});
