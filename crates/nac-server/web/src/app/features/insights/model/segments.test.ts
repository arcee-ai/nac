import { describe, expect, it } from "vitest";

import {
  assistant,
  compactTool,
  completionTurn,
  modelTurn,
  snapshot,
  text,
  thoughts,
  thread,
  toolCall,
  toolDetail,
  toolResult,
  userTurn,
  wave,
  workset,
} from "@/app/features/insights/model/fixtures.test-support";
import {
  insightAnchor,
  LEADING_ANCHOR,
  partitionModelTurn,
} from "@/app/features/insights/model/segments";
import { combineStatuses, segmentStatus } from "@/app/features/insights/model/status";
import type {
  ActionStatus,
  InsightGroupEntry,
  ModelTurnItem,
} from "@/app/features/insights/model/types";
import type { ToolPresentationStatus } from "@/app/lib/toolPresentation";
import {
  buildTranscript,
  STREAMING_TURN_KEY,
  withStreamedOutput,
  type ModelTurn,
  type TranscriptBlock,
  type TranscriptTurn,
} from "@/app/lib/transcript";
import type { Message } from "@/app/types/api";

const CHILD_ID = "0b6f3c1e-5d1a-4f8e-9a51-2f0f4c3b7a10";

function items(blocks: TranscriptBlock[]): readonly ModelTurnItem[] {
  return partitionModelTurn(modelTurn(1, blocks), userTurn(0));
}

function groups(blocks: TranscriptBlock[]): InsightGroupEntry[] {
  return items(blocks).filter((item): item is InsightGroupEntry => item.kind === "group");
}

function shape(list: readonly ModelTurnItem[]): string[] {
  return list.map((item) => {
    if (item.kind === "block") return `block:${item.block.key}`;
    if (item.kind === "session") return `session:${item.id}`;
    return `group:${item.group.segments.map((segment) => segment.key).join(",")}`;
  });
}

function modelAt(turns: TranscriptTurn[], index: number): ModelTurn {
  const turn = turns[index];
  if (turn?.kind !== "model") throw new Error(`turn ${index} is not a model turn`);
  return turn;
}

function groupIds(turns: TranscriptTurn[]): string[] {
  return turns.flatMap((turn, index) =>
    turn.kind === "model"
      ? partitionModelTurn(turn, turns[index - 1]).flatMap((item) =>
          item.kind === "group" ? [item.id] : [],
        )
      : [],
  );
}

describe("partitionModelTurn", () => {
  it("groups consecutive reasoning, tool and workset blocks and closes a group at text", () => {
    const list = items([
      thoughts("thoughts-0"),
      toolDetail("read", { summary: "src/app/index.tsx" }),
      text("text-0"),
      compactTool("thread_delete-3-0", "thread_delete"),
      workset("workset_define-3-1", "polylang"),
      thoughts("thoughts-1", { text: "  " }),
      toolDetail("edit"),
    ]);

    expect(shape(list)).toEqual([
      "group:thoughts-0,tool-call-read",
      "block:text-0",
      "group:thread_delete-3-0,workset_define-3-1,tool-call-edit",
    ]);
    expect(list.map((item) => (item.kind === "block" ? item.block.key : item.id))).toEqual([
      "user-0:thoughts-0",
      "text-0",
      "user-0:thread_delete-3-0",
    ]);
  });

  it("emits waves and launched sessions as items of their own", () => {
    const list = items([
      thoughts("thoughts-0"),
      wave("wave-2", [[thread("impl/calendar", "impl/calendar@2:call-a")]]),
      thoughts("thoughts-1"),
      toolDetail("subagent", {
        summary: "Fix the flaky test",
        status: "running",
        spawnedSessionId: CHILD_ID,
      }),
      toolDetail("read"),
      toolDetail("orchestrator_launch", { status: "error" }),
    ]);

    expect(shape(list)).toEqual([
      "group:thoughts-0",
      "block:wave-2",
      "group:thoughts-1",
      "session:user-0:tool-call-subagent",
      "group:tool-call-read",
      "session:user-0:tool-call-orchestrator_launch",
    ]);
    expect(list[3]).toMatchObject({
      action: "spawn-agent",
      rowKey: `child:${CHILD_ID}`,
      title: "Fix the flaky test",
      status: "running",
    });
    expect(list[5]).toMatchObject({
      action: "spawn-orchestrator",
      rowKey: null,
      title: "Spawn Orchestrator",
      status: "failed",
    });
  });

  it("emits no group for prose alone", () => {
    expect(shape(items([text("text-0")]))).toEqual(["block:text-0"]);
    expect(items([])).toEqual([]);
  });

  it.each<[ToolPresentationStatus, ActionStatus, boolean]>([
    ["pending", "running", true],
    ["running", "running", true],
    ["awaiting-approval", "pending", true],
    ["success", "ready", false],
    ["error", "failed", false],
    ["timed-out", "failed", false],
    ["cancelled", "failed", false],
    ["interrupted", "failed", false],
  ])("maps a %s tool to %s and keeps its presentation", (status, expected, pending) => {
    const block = toolDetail("exec_command", { status, summary: "npm test" });
    const [entry] = groups([block]);
    const [segment] = entry.group.segments;

    expect(segment).toMatchObject({ kind: "tool", action: "run-command", pending });
    expect(segment.kind === "tool" ? segment.presentation : null).toBe(block.presentation);
    expect(segmentStatus(segment)).toBe(expected);
    expect(entry.group.status).toBe(expected);
  });

  it("reports the most urgent segment status for the group", () => {
    const status = (...statuses: ToolPresentationStatus[]) =>
      groups(statuses.map((value, index) => toolDetail(`tool${index}`, { status: value })))[0].group
        .status;

    expect(status("success", "error", "awaiting-approval", "running")).toBe("running");
    expect(status("success", "error", "awaiting-approval")).toBe("pending");
    expect(status("success", "interrupted")).toBe("failed");
    expect(status("success", "success")).toBe("ready");
    expect(
      groups([thoughts("thoughts-0", { streaming: true }), toolDetail("read")])[0].group.status,
    ).toBe("running");
    expect(groups([workset("workset_define-1-0", "w", true)])[0].group.status).toBe("running");
    expect(combineStatuses([])).toBe("ready");
  });

  it("sums the group duration only when every segment's is known", () => {
    const [known] = groups([
      thoughts("thoughts-0", { durationMs: 800 }),
      toolDetail("exec_command", { status: "timed-out", durationMs: 200 }),
    ]);
    const [unknown] = groups([thoughts("thoughts-0", { durationMs: 800 }), toolDetail("read")]);

    expect(known.group.durationMs).toBe(1_000);
    expect(unknown.group.durationMs).toBeNull();
  });

  it("turns compact orchestrator tool blocks into segments without a presentation", () => {
    const [running] = groups([
      thoughts("thoughts-0"),
      compactTool("thread_delete-1-0", "thread_delete", true),
    ]);
    const [settled] = groups([
      thoughts("thoughts-0"),
      compactTool("thread_delete-1-0", "thread_delete"),
    ]);

    expect(running.group.segments[1]).toEqual({
      kind: "tool",
      key: "thread_delete-1-0",
      name: "thread_delete",
      action: "delete-thread",
      presentation: null,
      pending: true,
    });
    expect(running.group.status).toBe("running");
    expect(settled.group.status).toBe("ready");
    expect(settled.group.durationMs).toBeNull();
  });

  it("never sees the orchestrator lookups the transcript drops", () => {
    const calls = [
      toolCall("call-threads", "threads"),
      toolCall("call-thread-read", "thread_read", { name: "impl" }),
      toolCall("call-workset-read", "workset_read", { id: "w" }),
      toolCall("call-workset-list", "workset_list"),
      toolCall("call-delete", "thread_delete", { name: "impl" }),
    ];
    const turns = buildTranscript(
      snapshot([
        { role: "user", content: "Clean up the threads" },
        assistant({ reasoning: "Only the stale thread has to go.", calls }),
        ...calls.map((call) => toolResult(call.id)),
      ]),
      {},
    );

    const list = partitionModelTurn(modelAt(turns, 1), turns[0]);
    expect(shape(list)).toEqual(["group:thoughts-0,thread_delete-1-4"]);
  });

  it("keeps ids when another assistant message joins the turn", () => {
    const first: Message[] = [
      { role: "user", content: "Fix the store" },
      assistant({
        reasoning: "Look at the store first.",
        calls: [toolCall("call-read", "read", { path: "src/app/store.ts" })],
      }),
      toolResult("call-read"),
    ];
    const before = buildTranscript(snapshot(first, "direct"), {});
    const after = buildTranscript(
      snapshot(
        [...first, assistant({ reasoning: "Now patch it.", content: "Patched the store." })],
        "direct",
      ),
      {},
    );

    expect(modelAt(before, 1).key).not.toBe(modelAt(after, 1).key);
    expect(groupIds(before)).toEqual(["user-0:thoughts-0"]);
    expect(groupIds(after)).toEqual(["user-0:thoughts-0"]);
    expect(shape(partitionModelTurn(modelAt(after, 1), after[0]))).toEqual([
      "group:thoughts-0,tool-call-read,thoughts-1",
      "block:text-0",
    ]);
  });

  it("keeps ids while streamed reasoning grows and once it is committed", () => {
    const prompt: TranscriptTurn[] = [userTurn(0)];
    const early = withStreamedOutput(prompt, { reasoning: "Let me", text: "" });
    const later = withStreamedOutput(prompt, { reasoning: "Let me check the store.", text: "" });
    const committed = buildTranscript(
      snapshot(
        [
          { role: "user", content: "Prompt 0" },
          assistant({ reasoning: "Let me check the store." }),
        ],
        "direct",
      ),
      {},
    );

    expect(modelAt(early, 1).key).toBe(STREAMING_TURN_KEY);
    expect(groupIds(early)).toEqual(["user-0:thoughts-0"]);
    expect(groupIds(later)).toEqual(["user-0:thoughts-0"]);
    expect(groupIds(committed)).toEqual(["user-0:thoughts-0"]);
    expect(groups(modelAt(later, 1).blocks)[0].group.status).toBe("running");
    expect(groups(modelAt(committed, 1).blocks)[0].group.status).toBe("ready");
  });

  it("moves a streamed turn onto its prompt once the snapshot shows the prompt", () => {
    const previousRun: TranscriptTurn[] = [userTurn(0), modelTurn(1, [thoughts("thoughts-0")])];
    const stream = { reasoning: "Plan the next step.", text: "" };

    const provisional = withStreamedOutput(previousRun, stream, true);
    const promptLanded = withStreamedOutput([...previousRun, userTurn(2)], stream);
    const committed: TranscriptTurn[] = [
      ...previousRun,
      userTurn(2),
      modelTurn(3, [thoughts("thoughts-0", { text: stream.reasoning })]),
    ];

    // The previous run's ids stay its own while the new prompt is still optimistic.
    expect(groupIds(provisional)).toEqual(["user-0:thoughts-0", "model-streaming:thoughts-0"]);
    // The one unavoidable transition: the provisional anchor gives way to the prompt.
    expect(groupIds(promptLanded)).toEqual(["user-0:thoughts-0", "user-2:thoughts-0"]);
    expect(groupIds(committed)).toEqual(["user-0:thoughts-0", "user-2:thoughts-0"]);
  });

  it("anchors ids on the turn before, never on the model turn's own key", () => {
    const model = modelTurn(1, []);
    const streaming: ModelTurn = { ...model, key: STREAMING_TURN_KEY, messageIndex: null };

    expect(insightAnchor(model, userTurn(0))).toBe("user-0");
    expect(insightAnchor(model, completionTurn(0))).toBe("delegated-completion-0");
    expect(insightAnchor(model, undefined)).toBe(LEADING_ANCHOR);
    expect(insightAnchor(streaming, userTurn(0))).toBe("user-0");
    expect(insightAnchor(streaming, modelTurn(0, []))).toBe(STREAMING_TURN_KEY);
  });

  it("partitions a turn object once per anchor", () => {
    const turn = modelTurn(1, [thoughts("thoughts-0")]);
    const first = partitionModelTurn(turn, userTurn(0));

    expect(partitionModelTurn(turn, userTurn(0))).toBe(first);
    expect(partitionModelTurn({ ...turn, blocks: [...turn.blocks] }, userTurn(0))).not.toBe(first);
    expect(partitionModelTurn(turn, userTurn(2))).not.toBe(first);
  });
});
