import { describe, expect, it } from "vitest";

import { buildTranscript, partitionThreadCalls } from "@/app/lib/transcript";
import type { SessionSnapshotResponse, ToolCall } from "@/app/types/api";

function threadCall(
  id: string,
  name: string,
  threads: string[] = [],
): ToolCall {
  return {
    id,
    type: "function",
    function: {
      name: "thread",
      arguments: JSON.stringify({ name, action: `Work on ${name}`, threads }),
    },
  };
}

function snapshot(
  messages: SessionSnapshotResponse["messages"],
): SessionSnapshotResponse {
  return {
    messages,
    message_created_at: messages.map((_, index) =>
      index === 1 ? "2026-08-07T12:00:00Z" : null,
    ),
    response_timing: { response_durations_ms: [1250] },
    thread_events: {},
  } as unknown as SessionSnapshotResponse;
}

describe("transcript projection", () => {
  it("groups user, model prose, reasoning, and thread DAG waves", () => {
    const research = threadCall("call-research", "research");
    const implement = threadCall("call-implement", "implement", ["research"]);
    const turns = buildTranscript(
      snapshot([
        { role: "system", content: "instructions" },
        { role: "user", content: "Ship it" },
        {
          role: "assistant",
          content: "I will delegate.",
          reasoning_text: "Plan safely.",
          tool_calls: [research, implement],
        },
      ]),
      {},
    );

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      kind: "user",
      text: "Ship it",
      messageIndex: 1,
      createdAt: "2026-08-07T12:00:00Z",
    });
    expect(turns[1]).toMatchObject({
      kind: "model",
      durationMs: 1250,
      blocks: [
        { kind: "thoughts", text: "Plan safely.", streaming: false },
        { kind: "text", text: "I will delegate." },
        {
          kind: "wave",
          rows: [
            [{ name: "research", state: "running" }],
            [{ name: "implement", state: "pending" }],
          ],
        },
      ],
    });
  });

  it("never projects the durable next message into canonical turns", () => {
    const projected = snapshot([{ role: "user", content: "active prompt" }]);
    projected.queued_message = {
      session_id: "session-1",
      queued_run_id: "queued-1",
      client_message_id: "client-1",
      display_prompt: "next prompt",
      agent_prompt: "next prompt",
      after_run_id: "run-1",
      state: "pending",
      admitted_run_id: null,
      version: 0,
      created_at: "2026-08-07T00:00:00Z",
      updated_at: "2026-08-07T00:00:00Z",
    };

    expect(buildTranscript(projected, {}).map((turn) => turn.kind === "user" && turn.text))
      .toEqual(["active prompt"]);
  });

  it("falls back to one row for cyclic thread dependencies", () => {
    const left = threadCall("left", "left", ["right"]);
    const right = threadCall("right", "right", ["left"]);

    expect(partitionThreadCalls([left, right])).toEqual([[left, right]]);
  });
});


it("offers only server-issued boundaries on the following user turn", () => {
  const projected = snapshot([
    { role: "user", content: "first" },
    { role: "assistant", content: "answer" },
    { role: "user", content: "branch here" },
  ]);
  projected.fork_boundary_tokens = [null, "opaque-server-token", null];
  const turns = buildTranscript(projected, {});
  expect(turns[0]).toMatchObject({ kind: "user", forkBoundaryToken: null });
  expect(turns[2]).toMatchObject({
    kind: "user",
    forkBoundaryToken: "opaque-server-token",
  });
});

function threadCards(projected: ReturnType<typeof buildTranscript>) {
  return projected.flatMap((turn) =>
    turn.kind === "model"
      ? turn.blocks.flatMap((block) => block.kind === "wave" ? block.rows.flat() : [])
      : [],
  );
}

describe("background dispatch identity", () => {
  it("treats thread results as acceptance and uses exact snapshot state", () => {
    const call = threadCall("call-bg", "impl", ["research"]);
    const projected = snapshot([
      { role: "user", content: "ship" },
      { role: "assistant", content: "", tool_calls: [call] },
      { role: "tool", tool_call_id: call.id, content: "Thread 'impl' accepted for background execution." },
    ]);
    projected.active_threads = ["impl"];
    projected.active_thread_dispatches = [{ run_id: "run-1", thread_name: "impl", dispatch_id: "dispatch-1", tool_call_id: call.id, status: "dependency_pending" }];
    expect(threadCards(buildTranscript(projected, {}))).toEqual([
      expect.objectContaining({ key: "dispatch-1", name: "impl", state: "pending" }),
    ]);
  });

  it("does not apply a reused name's live dispatch to historical cards", () => {
    const first = threadCall("call-old", "impl");
    const second = threadCall("call-new", "impl");
    const projected = snapshot([
      { role: "user", content: "first" },
      { role: "assistant", content: "", tool_calls: [first] },
      { role: "tool", tool_call_id: first.id, content: "legacy completed output" },
      { role: "assistant", content: "done" },
      { role: "user", content: "again" },
      { role: "assistant", content: "", tool_calls: [second] },
      { role: "tool", tool_call_id: second.id, content: "Thread 'impl' accepted for background execution." },
    ]);
    projected.active_thread_dispatches = [{ run_id: "run-2", thread_name: "impl", dispatch_id: "dispatch-new", tool_call_id: second.id, status: "running" }];
    const live = { impl: { name: "impl", status: "failed" as const, runId: "run-2", dispatchId: "dispatch-new", toolCallId: second.id, action: "again", exitCode: 1, isError: true, log: [] } };
    const cards = threadCards(buildTranscript(projected, live));
    expect(cards.map((card) => card.state)).toEqual(["done", "error"]);
    expect(cards.map((card) => card.key)).toEqual(["impl#0", "dispatch-new"]);
  });

  it("projects exact persisted failure and live cancellation across reconnect", () => {
    const failed = threadCall("call-failed", "research");
    const cancelled = threadCall("call-cancelled", "impl");
    const projected = snapshot([
      { role: "user", content: "work" },
      { role: "assistant", content: "", tool_calls: [failed, cancelled] },
      { role: "tool", tool_call_id: failed.id, content: "Thread 'research' accepted for background execution." },
      { role: "tool", tool_call_id: cancelled.id, content: "Thread 'impl' accepted for background execution." },
      { role: "assistant", content: "[run cancelled by user]" },
    ]);
    projected.thread_events = { research: [{ type: "thread_finished", name: "research", exit_code: 1, timed_out: false, run_id: "run-1", dispatch_id: "dispatch-failed", tool_call_id: failed.id, status: "failed" }] };
    expect(threadCards(buildTranscript(projected, {})).map((card) => card.state)).toEqual(["error", "cancelled"]);
  });

  it("keeps thread_wait completion text out of user turns", () => {
    const wait: ToolCall = { id: "wait-1", type: "function", function: { name: "thread_wait", arguments: "{}" } };
    const projected = snapshot([
      { role: "user", content: "work" },
      { role: "assistant", content: "", tool_calls: [wait] },
      { role: "tool", tool_call_id: wait.id, content: "impl: completed payload" },
      { role: "assistant", content: "final" },
    ]);
    expect(buildTranscript(projected, {}).filter((turn) => turn.kind === "user")).toHaveLength(1);
  });
});

it("reconciles an older exact completion when the newest reused name was cancelled", () => {
  const first = threadCall("call-first", "impl");
  const second = threadCall("call-second", "impl");
  const projected = snapshot([
    { role: "user", content: "first" },
    { role: "assistant", content: "", tool_calls: [first] },
    { role: "tool", tool_call_id: first.id, content: "Thread 'impl' accepted for background execution." },
    { role: "assistant", content: "first done" },
    { role: "user", content: "second" },
    { role: "assistant", content: "", tool_calls: [second] },
    { role: "tool", tool_call_id: second.id, content: "Thread 'impl' accepted for background execution." },
    { role: "assistant", content: "[run cancelled by user]" },
  ]);
  projected.thread_events = {
    impl: [{
      type: "thread_finished",
      name: "impl",
      exit_code: 0,
      timed_out: false,
      run_id: "run-first",
      dispatch_id: "dispatch-first",
      tool_call_id: first.id,
      status: "completed",
    }],
  };
  expect(threadCards(buildTranscript(projected, {})).map((card) => card.state))
    .toEqual(["done", "cancelled"]);
});
