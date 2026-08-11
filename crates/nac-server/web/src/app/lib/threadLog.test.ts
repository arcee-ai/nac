import { describe, expect, it } from "vitest";

import {
  mergeThreadEventPages,
  mergeThreadLog,
  persistedThreadLog,
  threadLogLine,
} from "@/app/lib/threadLog";
import type {
  AgentEvent,
  ThreadEventPage,
  ThreadEventRecord,
} from "@/app/types/api";

function logEvent(line: string): AgentEvent {
  return { type: "thread_log", line } as AgentEvent;
}

function callEvent(callId: string): AgentEvent {
  return {
    type: "tool_call_started",
    call_id: callId,
    name: "read",
    args_preview: "file.ts",
    key_arg_preview: "file.ts",
  } as AgentEvent;
}

function record(id: number): ThreadEventRecord {
  return { id, created_at: `t-${id}`, event: logEvent(`event-${id}`) };
}

function page(ids: number[], hasOlder: boolean): ThreadEventPage {
  return {
    events: ids.map(record),
    has_older: hasOlder,
    next_before_id: hasOlder ? Math.min(...ids) : null,
  };
}

describe("thread history paging", () => {
  it("normalizes newest and overlapping older pages chronologically", () => {
    const merged = mergeThreadEventPages([
      page([104, 105], true),
      page([102, 103, 104], false),
    ]);

    expect(
      merged.map((event) => (event.type === "thread_log" ? event.line : null)),
    ).toEqual(["event-102", "event-103", "event-104", "event-105"]);
  });

  it("collapses a live tool event once the persisted copy arrives", () => {
    const event = callEvent("call-1");
    const live = threadLogLine(event, 900);
    expect(live).not.toBeNull();
    if (!live) return;

    expect(mergeThreadLog(persistedThreadLog([event]), [live])).toHaveLength(1);
  });
});
