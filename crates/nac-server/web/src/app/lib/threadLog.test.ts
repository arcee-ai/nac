import { describe, expect, it } from "vitest";

import {
  mergeThreadEventPages,
  mergeThreadLog,
  persistedThreadLog,
  threadLogLine,
  toolCallFailed,
} from "@/app/lib/threadLog";
import type { AgentEvent, ThreadEventPage, ThreadEventRecord } from "@/app/types/api";

function logEvent(line: string): AgentEvent {
  // SAFETY: test fixture — the merge logic under test only reads `type` and
  // `line` from thread_log events, so the remaining fields are omitted.
  return { type: "thread_log", line } as AgentEvent;
}

function callEvent(callId: string): AgentEvent {
  // SAFETY: test fixture — only the tool_call_started fields the merge logic
  // reads are populated; the optional event fields are omitted.
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

describe("tool-call status", () => {
  it.each(["timed_out", "cancelled", "spawn_error"] as const)(
    "renders %s commands as failures",
    (command_status) => {
      expect(
        toolCallFailed({
          is_error: false,
          content_preview: command_status.replace("_", " "),
          command_status,
        }),
      ).toBe(true);
    },
  );

  it("keeps completed commands with nonzero exits successful", () => {
    const line = threadLogLine(
      {
        type: "tool_call_finished",
        call_id: "command-1",
        name: "exec_command",
        content_preview: "exit 7: failed assertion",
        is_error: false,
        command_status: "completed",
        exit_code: 7,
      },
      0,
    );

    expect(line).toMatchObject({ mark: "✓", isError: false });
  });

  it("keeps legacy timeout previews marked as failures", () => {
    expect(
      toolCallFailed({
        is_error: false,
        content_preview: "Command timed out after 1000ms",
      }),
    ).toBe(true);
  });
});

describe("thread history paging", () => {
  it("normalizes newest and overlapping older pages chronologically", () => {
    const merged = mergeThreadEventPages([page([104, 105], true), page([102, 103, 104], false)]);

    expect(merged.map((event) => (event.type === "thread_log" ? event.line : null))).toEqual([
      "event-102",
      "event-103",
      "event-104",
      "event-105",
    ]);
  });

  it("collapses a live tool event once the persisted copy arrives", () => {
    const event = callEvent("call-1");
    const live = threadLogLine(event, 900);
    expect(live).not.toBeNull();
    if (!live) return;

    expect(mergeThreadLog(persistedThreadLog([event]), [live])).toHaveLength(1);
  });
});
