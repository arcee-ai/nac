import { describe, expect, it } from "vitest";

import {
  indexToolEvents,
  presentToolCall,
  type ToolPresentationStatus,
} from "@/app/lib/toolPresentation";
import type { AgentEvent, ToolCall } from "@/app/types/api";

function call(name: string, argumentsText = "{}"): ToolCall {
  return { id: `call-${name}`, type: "function", function: { name, arguments: argumentsText } };
}

function started(
  name: string,
  preview: string,
): Extract<AgentEvent, { type: "tool_call_started" }> {
  return {
    type: "tool_call_started",
    thread_name: null,
    call_id: `call-${name}`,
    name,
    args_preview: '{"operation":"invoke"}',
    key_arg_preview: preview,
  };
}

function finished(
  name: string,
  options: Partial<Extract<AgentEvent, { type: "tool_call_finished" }>> = {},
): Extract<AgentEvent, { type: "tool_call_finished" }> {
  return {
    type: "tool_call_finished",
    thread_name: null,
    call_id: `call-${name}`,
    name,
    content_preview: "bounded result",
    is_error: false,
    ...options,
  };
}

function present(name: string, events: AgentEvent[], active = false) {
  return presentToolCall({
    call: call(name, '{"password":"RAW_SECRET","body":"UNBOUNDED_BODY"}'),
    events: indexToolEvents(events).get(`call-${name}`),
    hasResult: events.some((event) => event.type === "tool_call_finished"),
    resultText: null,
    resultHasImage: false,
    active,
    turnCancelled: false,
  });
}

describe("tool presentation mapper", () => {
  it("uses product vocabulary across direct tool families", () => {
    const cases = [
      ["read", "Read file"],
      ["write", "Write file"],
      ["edit", "Edit file"],
      ["glob", "Find files"],
      ["grep", "Search files"],
      ["exec_command", "Run command"],
      ["write_stdin", "Use terminal"],
      ["read_command_output", "Read command output"],
      ["web_search", "Search web"],
      ["web_fetch", "Fetch web page"],
      ["subagent", "Start coding agent"],
      ["orchestrator_launch", "Start orchestrator"],
      ["session_spawn", "Start session"],
      ["session_status", "Check session"],
      ["session_wait", "Wait for session"],
    ] as const;

    for (const [name, label] of cases) {
      expect(present(name, [started(name, "safe preview")], true)).toMatchObject({
        label,
        summary: "safe preview",
        status: "running",
      });
    }
  });

  it("handles MCP and unknown names with bounded safe fallbacks", () => {
    expect(present("mcp__linear__linear_read_issue", [])).toMatchObject({
      label: "MCP · Linear read issue",
      status: "interrupted",
      summary: null,
    });
    const unknown = present(`${"unknown_".repeat(40)}tool`, []);
    expect([...unknown.name]).toHaveLength(160);
    expect(JSON.stringify(unknown)).not.toContain("RAW_SECRET");
    expect(JSON.stringify(unknown)).not.toContain("UNBOUNDED_BODY");
  });

  it.each<
    [string, Partial<Extract<AgentEvent, { type: "tool_call_finished" }>>, ToolPresentationStatus]
  >([
    ["success", { command_status: "completed" }, "success"],
    ["error", { is_error: true }, "error"],
    ["exit", { command_status: "completed", exit_code: 7 }, "error"],
    ["timeout", { command_status: "timed_out" }, "timed-out"],
    ["cancel", { command_status: "cancelled" }, "cancelled"],
    ["spawn", { command_status: "spawn_error" }, "error"],
  ])("maps the %s terminal outcome", (name, options, status) => {
    expect(present(name, [started(name, "safe"), finished(name, options)])).toMatchObject({
      status,
      resultPreview: "bounded result",
    });
  });

  it("distinguishes pending, running, cancellation, interruption, and images", () => {
    expect(
      presentToolCall({
        call: call("read"),
        hasResult: false,
        resultText: null,
        resultHasImage: false,
        active: true,
        turnCancelled: false,
      }).status,
    ).toBe("pending");
    expect(present("read", [started("read", "file.rs")], true).status).toBe("running");
    expect(
      presentToolCall({
        call: call("read"),
        hasResult: false,
        resultText: null,
        resultHasImage: false,
        active: false,
        turnCancelled: true,
      }).status,
    ).toBe("cancelled");
    expect(
      presentToolCall({
        call: call("read"),
        hasResult: false,
        resultText: null,
        resultHasImage: false,
        active: false,
        turnCancelled: false,
      }).status,
    ).toBe("interrupted");
    expect(
      presentToolCall({
        call: call("read"),
        hasResult: true,
        resultText: null,
        resultHasImage: true,
        active: false,
        turnCancelled: false,
      }).resultPreview,
    ).toBe("Image result");
  });

  it("ignores worker events and malformed or missing optional event data", () => {
    const worker = started("read", "must not appear");
    worker.thread_name = "worker";
    expect(indexToolEvents([worker]).size).toBe(0);
    expect(
      presentToolCall({
        call: call("unknown", "malformed SECRET"),
        hasResult: false,
        resultText: null,
        resultHasImage: false,
        active: false,
        turnCancelled: false,
      }),
    ).toMatchObject({ summary: null, statusLabel: "Interrupted" });
  });
});
