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
      ["orchestrator_launch", "Start NAC orchestrator"],
      ["orchestrator_wait", "Wait for NAC orchestrator"],
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
    ["generic-timeout", { completion_status: "timed_out" }, "timed-out"],
    ["generic-cancel", { completion_status: "cancelled" }, "cancelled"],
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
        events: indexToolEvents([started("read", "file.rs")]).get("call-read"),
        hasResult: false,
        resultText: null,
        resultHasImage: false,
        active: true,
        awaitingApproval: true,
        turnCancelled: false,
      }),
    ).toMatchObject({ status: "awaiting-approval", statusLabel: "Awaiting approval" });
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

describe("tool durations and spawned sessions", () => {
  const CHILD_ID = "0b6f3c1e-5d1a-4f8e-9a51-2f0f4c3b7a10";
  const ORCHESTRATOR_ID = "7d2e9f40-1c3b-4a6d-8e5f-90a1b2c3d4e5";

  function launch(name: string, args: Record<string, unknown>, resultText: string | null) {
    return presentToolCall({
      call: call(name, JSON.stringify(args)),
      events: indexToolEvents([started(name, "Investigate the flaky test")]).get(`call-${name}`),
      hasResult: resultText !== null,
      resultText,
      resultHasImage: false,
      active: resultText === null,
      turnCancelled: false,
    });
  }

  it("reads a new child from the foreground durable record", () => {
    const record = {
      child_session_id: CHILD_ID,
      parent_session_id: "parent-session",
      root_session_id: "parent-session",
      profile: "general",
      description: "Investigate the flaky test",
      nesting_depth: 1,
      status: "completed",
      generation: 1,
      report: "Fixed the race.",
    };
    const presentation = launch(
      "subagent",
      { child_session_id: null, background: false },
      JSON.stringify(record),
    );

    expect(presentation.spawnedSessionId).toBe(CHILD_ID);
    expect(JSON.stringify(presentation)).not.toContain("Fixed the race.");
  });

  it("reads a new orchestrator from the background acknowledgement", () => {
    const ack = {
      orchestrator_session_id: ORCHESTRATOR_ID,
      generation: 0,
      status: "running",
      message: "The orchestrator is running in the background.",
    };

    expect(
      launch(
        "orchestrator_launch",
        { orchestrator_session_id: null, background: true },
        JSON.stringify(ack),
      ).spawnedSessionId,
    ).toBe(ORCHESTRATOR_ID);
  });

  it("takes a continued session from the arguments before any result exists", () => {
    expect(launch("subagent", { child_session_id: CHILD_ID }, null).spawnedSessionId).toBe(
      CHILD_ID,
    );
    expect(
      launch("orchestrator_launch", { orchestrator_session_id: ORCHESTRATOR_ID }, null)
        .spawnedSessionId,
    ).toBe(ORCHESTRATOR_ID);
  });

  it("omits the session id when neither the arguments nor the result name one", () => {
    const results = [
      null,
      "{not json",
      `Error: foreground subagent failed (child_session_id: ${CHILD_ID}): boom`,
      JSON.stringify([CHILD_ID]),
      JSON.stringify({ child_session_id: CHILD_ID }),
      JSON.stringify({ child_session_id: CHILD_ID, generation: "1", status: "running" }),
      JSON.stringify({ child_session_id: "", generation: 1, status: "running" }),
      JSON.stringify({ child_session_id: "two words", generation: 1, status: "running" }),
      JSON.stringify({
        orchestrator_session_id: ORCHESTRATOR_ID,
        generation: 1,
        status: "running",
      }),
    ];

    for (const resultText of results) {
      expect(launch("subagent", { child_session_id: null }, resultText)).not.toHaveProperty(
        "spawnedSessionId",
      );
    }
    expect(
      presentToolCall({
        call: call("subagent", "malformed"),
        hasResult: false,
        resultText: null,
        resultHasImage: false,
        active: true,
        turnCancelled: false,
      }),
    ).not.toHaveProperty("spawnedSessionId");
  });

  it("never reads a session id for tools that do not launch one", () => {
    const ack = JSON.stringify({ child_session_id: CHILD_ID, generation: 1, status: "running" });

    expect(launch("subagent_status", { child_session_id: CHILD_ID }, ack)).not.toHaveProperty(
      "spawnedSessionId",
    );
    expect(
      launch("orchestrator_wait", { orchestrator_session_id: ORCHESTRATOR_ID }, ack),
    ).not.toHaveProperty("spawnedSessionId");
  });

  it("exposes the execution duration only when the finish event reports one", () => {
    expect(
      present("exec_command", [
        started("exec_command", "npm test"),
        finished("exec_command", { command_status: "timed_out", execution_duration_ms: 30_000 }),
      ]),
    ).toMatchObject({ status: "timed-out", durationMs: 30_000 });
    expect(
      present("read", [started("read", "file.rs"), finished("read", { execution_duration_ms: 0 })]),
    ).toMatchObject({ durationMs: 0 });

    expect(present("read", [started("read", "file.rs"), finished("read")])).not.toHaveProperty(
      "durationMs",
    );
    expect(
      present("read", [
        started("read", "file.rs"),
        finished("read", { execution_duration_ms: null }),
      ]),
    ).not.toHaveProperty("durationMs");
    expect(present("read", [started("read", "file.rs")], true)).not.toHaveProperty("durationMs");
  });
});
