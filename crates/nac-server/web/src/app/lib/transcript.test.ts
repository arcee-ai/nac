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
