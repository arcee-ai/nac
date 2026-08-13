import { describe, expect, it } from "vitest";

import {
  mergeMessageTail,
  mergeFocusedSnapshot,
  prependMessagePage,
} from "@/app/lib/messageWindow";
import { buildTranscript } from "@/app/lib/transcript";
import type {
  AgentEvent,
  Message,
  MessagesPageResponse,
  SessionSnapshotResponse,
} from "@/app/types/api";

function user(content: string): Message {
  return { role: "user", content } as Message;
}

function assistant(content: string): Message {
  return { role: "assistant", content } as Message;
}

function threadAssistant(name: string, callId: string): Message {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: callId,
        type: "function",
        function: {
          name: "thread",
          arguments: JSON.stringify({ name, action: callId }),
        },
      },
    ],
  } as unknown as Message;
}

function tool(callId: string): Message {
  return {
    role: "tool",
    tool_call_id: callId,
    content: "done",
  } as Message;
}

function toolStarted(callId: string): AgentEvent {
  return {
    type: "tool_call_started",
    call_id: callId,
    name: "read",
    args_preview: "latest.ts",
    key_arg_preview: "latest.ts",
  } as AgentEvent;
}

function system(content: string): Message {
  return { role: "system", content } as Message;
}

function snapshot(
  messages: Message[],
  start: number,
  total: number,
  durations: (number | null)[] = [],
): SessionSnapshotResponse {
  return {
    messages,
    message_created_at: messages.map((_, index) => `t-${start + index}`),
    message_page: {
      start,
      end: start + messages.length,
      total,
      has_older: start > 0,
    },
    response_timing: { response_durations_ms: durations },
    thread_events: {},
    thread_episodes: {},
  } as unknown as SessionSnapshotResponse;
}

function page(
  messages: Message[],
  start: number,
  total: number,
): MessagesPageResponse {
  return {
    messages,
    created_at: messages.map((_, index) => `t-${start + index}`),
    page: {
      start,
      end: start + messages.length,
      total,
      has_older: start > 0,
    },
  };
}

describe("raw message windows", () => {
  it("preserves a contiguous prefix while a newest page advances", () => {
    const current = snapshot(
      [user("u-6"), assistant("a-7"), user("u-8"), assistant("a-9")],
      6,
      10,
    );
    const incoming = page(
      [user("u-8"), assistant("a-9"), user("u-10"), assistant("a-11")],
      8,
      12,
    );

    const merged = mergeMessageTail(current, incoming);
    expect(merged.kind).toBe("accepted");
    if (merged.kind !== "accepted") return;
    expect(merged.snapshot.message_page).toMatchObject({
      start: 6,
      end: 12,
      total: 12,
    });
    expect(merged.snapshot.messages.map((message) => message.content)).toEqual([
      "u-6",
      "a-7",
      "u-8",
      "a-9",
      "u-10",
      "a-11",
    ]);
    expect(merged.snapshot.message_created_at).toEqual([
      "t-6",
      "t-7",
      "t-8",
      "t-9",
      "t-10",
      "t-11",
    ]);
  });

  it("prepends only the page that still joins the captured cursor", () => {
    const current = snapshot([user("u-4"), assistant("a-5")], 4, 6);
    const older = page([system("s-2"), user("u-3")], 2, 6);

    const accepted = prependMessagePage(current, older, 4);
    expect(accepted?.message_page).toMatchObject({ start: 2, end: 6, total: 6 });
    expect(prependMessagePage(current, older, 3)).toBeNull();
  });

  it("requires a canonical snapshot for shrink, gap, or invalid timestamps", () => {
    const current = snapshot([user("u-8"), assistant("a-9")], 8, 10);
    expect(mergeMessageTail(current, page([user("u")], 4, 5)).kind).toBe(
      "snapshot-required",
    );
    expect(mergeMessageTail(current, page([user("u")], 11, 12)).kind).toBe(
      "snapshot-required",
    );
    const invalid = page([user("u")], 9, 10);
    invalid.created_at = [];
    expect(mergeMessageTail(current, invalid).kind).toBe("snapshot-required");
  });

  it("keeps the accepted window when a focused snapshot is malformed", () => {
    const current = snapshot([user("kept"), assistant("answer")], 8, 10);
    const malformed = snapshot([user("bad")], 9, 10);
    malformed.message_created_at = [];

    expect(mergeFocusedSnapshot(current, malformed, false)).toBe(current);
  });
});

describe("bounded transcript projection", () => {
  it("keeps raw indexes and right-aligns completed durations", () => {
    const value = snapshot(
      [
        system("policy"),
        user("older"),
        assistant("older answer"),
        user("newest"),
        assistant("newest answer"),
      ],
      20,
      25,
      [100, 200, 300, 400],
    );

    const turns = buildTranscript(value, {});
    expect(turns.map((turn) => [turn.kind, turn.key])).toEqual([
      ["user", "user-21"],
      ["model", "model-22"],
      ["user", "user-23"],
      ["model", "model-24"],
    ]);
    expect(
      turns
        .filter((turn) => turn.kind === "user")
        .map((turn) => turn.messageIndex),
    ).toEqual([21, 23]);
    expect(
      turns
        .filter((turn) => turn.kind === "model")
        .map((turn) => turn.durationMs),
    ).toEqual([300, 400]);
  });

  it("leaves the active tail turn untimed", () => {
    const value = snapshot(
      [user("done"), assistant("done answer"), user("live"), assistant("partial")],
      50,
      54,
      [900],
    );
    value.active_run = {} as SessionSnapshotResponse["active_run"];

    const models = buildTranscript(value, {}).filter(
      (turn) => turn.kind === "model",
    );
    expect(models.map((turn) => turn.durationMs)).toEqual([900, null]);
  });

  it("retains model and thread identities across a partial-turn prepend", () => {
    const current = snapshot(
      [threadAssistant("worker", "call-new"), assistant("final")],
      50,
      52,
    );
    current.threads = [
      { name: "worker", episode_count: 2 },
    ] as SessionSnapshotResponse["threads"];
    current.thread_events = { worker: [toolStarted("event-new")] };
    const before = buildTranscript(current, {});

    const merged = prependMessagePage(
      current,
      page([threadAssistant("worker", "call-old"), tool("call-old")], 48, 52),
      50,
    );
    expect(merged).not.toBeNull();
    if (!merged) return;
    merged.threads = current.threads;
    const after = buildTranscript(merged, {});

    expect(before[0]?.key).toBe("model-51");
    expect(after[0]?.key).toBe(before[0]?.key);
    const beforeKeys =
      before[0]?.kind === "model"
        ? before[0].blocks.flatMap((block) =>
            block.kind === "wave"
              ? block.rows.flat().map((thread) => thread.key)
              : [],
          )
        : [];
    const afterKeys =
      after[0]?.kind === "model"
        ? after[0].blocks.flatMap((block) =>
            block.kind === "wave"
              ? block.rows.flat().map((thread) => thread.key)
              : [],
          )
        : [];
    expect(beforeKeys).toEqual(["worker@50:call-new"]);
    expect(afterKeys).toEqual([
      "worker@48:call-old",
      "worker@50:call-new",
    ]);
    const newestThread =
      before[0]?.kind === "model"
        ? before[0].blocks
            .filter((block) => block.kind === "wave")
            .flatMap((block) => block.rows.flat())
            .find((thread) => thread.key === "worker@50:call-new")
        : undefined;
    expect(newestThread?.log.map((line) => line.key)).toEqual([
      "call-event-new",
    ]);
  });

  it("renders every turn the user explicitly loaded", () => {
    const messages = Array.from({ length: 50 }, (_, index) => [
      user(`user-${index}`),
      assistant(`assistant-${index}`),
    ]).flat();
    expect(buildTranscript(snapshot(messages, 0, messages.length), {})).toHaveLength(
      100,
    );
  });
});
