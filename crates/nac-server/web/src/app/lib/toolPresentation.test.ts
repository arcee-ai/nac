import { describe, expect, it } from "vitest";

import {
  collectToolResults,
  indexToolEvents,
  presentToolCall,
  toolCallFailed,
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
      ["subagent", "Subagent request in progress"],
      ["orchestrator_launch", "Start NAC orchestrator"],
      ["orchestrator_wait", "Wait for NAC orchestrator"],
    ] as const;

    for (const [name, label] of cases) {
      expect(present(name, [started(name, "safe preview")], true)).toMatchObject({
        label,
        summary: name === "subagent" ? null : "safe preview",
        status: "running",
      });
    }
  });

  it.each([
    ["background_started", false, "Subagent started"],
    ["background_continued", false, "Instructions sent to subagent"],
    ["completed", false, "Subagent completed"],
    ["failed", true, "Subagent failed"],
    ["cancelled", true, "Subagent cancelled"],
    ["interrupted", true, "Subagent interrupted"],
    [undefined, false, "Subagent request finished"],
    [undefined, true, "Subagent request failed"],
  ] as const)("maps trusted child outcome %s", (outcome, isError, label) => {
    const item = present("subagent", [
      started("subagent", "review store"),
      finished("subagent", {
        delegation_outcome: outcome,
        delegation_summary: outcome ? "review store" : undefined,
        is_error: isError,
      }),
    ]);
    expect(item.label).toBe(label);
    expect(item.summary).toBe(outcome ? "review store" : null);
  });

  it("names pending and approval without claiming a launch", () => {
    const base = {
      call: call("subagent"),
      hasResult: false,
      resultText: null,
      resultHasImage: false,
      active: true,
      turnCancelled: false,
    };
    expect(presentToolCall(base).label).toBe("Subagent pending");
    expect(presentToolCall({ ...base, awaitingApproval: true }).label).toBe(
      "Subagent awaiting approval",
    );
    expect(presentToolCall({ ...base, active: false }).label).toBe("Subagent request interrupted");
  });

  it.each(["subagent", "subagent_status", "subagent_cancel"])(
    "hides historical %s JSON previews",
    (name) => {
      const item = present(name, [
        finished(name, { content_preview: '{"child_session_id":"secret"}' }),
      ]);
      expect(item.resultPreview).toBeNull();
    },
  );

  it.each([
    ["subagent", "Subagent request"],
    ["subagent_status", "Subagent status request"],
    ["subagent_cancel", "Subagent cancellation request"],
  ])("uses safe authoritative deadline wording for %s", (name, request) => {
    for (const [status, word] of [
      ["timed_out", "timed out"],
      ["cancelled", "cancelled"],
    ] as const) {
      const item = present(name, [
        finished(name, {
          is_error: true,
          completion_status: status,
          content_preview: "opaque-managed-secret",
        }),
      ]);
      expect(item.resultPreview).toBe(`${request} ${word}`);
      expect(JSON.stringify(item)).not.toContain("opaque-managed-secret");
    }
  });

  it.each([
    ["timed_out", "Subagent request timed out"],
    ["cancelled", "Subagent request cancelled"],
  ] as const)(
    "gives %s status precedence over an incompatible child outcome",
    (status, expected) => {
      const item = present("subagent", [
        finished("subagent", {
          is_error: true,
          completion_status: status,
          delegation_outcome: "completed",
          content_preview: "Subagent completed",
        }),
      ]);
      expect(item.label).toBe(expected);
      expect(item.resultPreview).toBe(expected);
    },
  );

  it("repairs only a legacy confirmed cancel request, keeping request deadlines authoritative", () => {
    const legacy = finished("subagent_cancel", {
      is_error: true,
      completion_status: "cancelled",
      delegation_outcome: "cancelled",
      content_preview: "Subagent cancellation request cancelled",
    });
    expect(present("subagent_cancel", [legacy])).toMatchObject({
      status: "success",
      resultPreview: "Subagent cancellation request finished",
    });
    expect(
      present("subagent_cancel", [{ ...legacy, delegation_outcome: undefined }]),
    ).toMatchObject({
      status: "cancelled",
      resultPreview: "Subagent cancellation request cancelled",
    });
    expect(
      present("subagent_cancel", [{ ...legacy, completion_status: "timed_out" }]),
    ).toMatchObject({
      status: "timed-out",
      resultPreview: "Subagent cancellation request timed out",
    });
  });

  it("shows a successful child cancellation request as completed", () => {
    const item = present("subagent_cancel", [
      finished("subagent_cancel", {
        is_error: false,
        completion_status: "success",
        delegation_outcome: "cancelled",
        content_preview: "Subagent cancellation request finished",
      }),
    ]);
    expect(item.status).toBe("success");
    expect(item.resultPreview).toBe("Subagent cancellation request finished");
  });

  it("keeps a confirmed child cancellation distinct from a cancelled request", () => {
    const item = present("subagent", [
      finished("subagent", {
        is_error: true,
        completion_status: "cancelled",
        delegation_outcome: "cancelled",
        content_preview: "Subagent cancelled",
      }),
    ]);
    expect(item.resultPreview).toBe("Subagent cancelled");
    expect(item.label).toBe("Subagent cancelled");
  });

  it("omits legacy non-JSON child previews that may contain opaque credentials", () => {
    const item = present("subagent", [
      finished("subagent", { content_preview: "opaque-managed-exact-secret" }),
    ]);
    expect(item.resultPreview).toBeNull();
  });

  it.each([
    ["background_launch", "Starting subagent…"],
    ["background_continuation", "Working with subagent…"],
    ["foreground", "Working with subagent…"],
  ] as const)("uses authorized invocation intent %s only while active", (intent, label) => {
    const event = { ...started("subagent", "Review store"), delegation_intent: intent };
    expect(present("subagent", [event], true)).toMatchObject({ label, summary: "Review store" });
    expect(
      presentToolCall({
        call: call("subagent"),
        events: { started: event },
        hasResult: false,
        resultText: null,
        resultHasImage: false,
        active: true,
        awaitingApproval: true,
        turnCancelled: false,
      }).label,
    ).toBe("Subagent awaiting approval");
  });

  it("merges sanitized progress with the initial summary for durable replay", () => {
    const start = started("subagent", "Review store");
    const progress = {
      ...start,
      args_preview: "",
      key_arg_preview: "Review store",
      delegation_intent: "background_launch",
    } as const;
    expect(present("subagent", [start, progress], true)).toMatchObject({
      label: "Starting subagent…",
      summary: "Review store",
    });
  });

  it("shows a native-verified summary before and during approval without claiming dispatch", () => {
    const event = { ...started("subagent", "Review store"), delegation_summary_verified: true };
    const base = {
      call: call("subagent"),
      events: { started: event },
      hasResult: false,
      resultText: null,
      resultHasImage: false,
      active: true,
      turnCancelled: false,
    };
    expect(presentToolCall(base)).toMatchObject({
      label: "Subagent request in progress",
      summary: "Review store",
    });
    expect(presentToolCall({ ...base, awaitingApproval: true })).toMatchObject({
      label: "Subagent awaiting approval",
      summary: "Review store",
    });
  });

  it("omits unproven legacy summaries even when they contain opaque secrets", () => {
    const legacy = started("subagent", "opaque-managed-exact-secret");
    expect(present("subagent", [legacy], true).summary).toBeNull();
    expect(present("subagent", [legacy, finished("subagent")]).summary).toBeNull();
    const safeProgress = {
      ...legacy,
      key_arg_preview: "Safe task",
      delegation_intent: "background_launch",
    } as const;
    expect(present("subagent", [legacy, safeProgress], true).summary).toBe("Safe task");
    const missingProgress = { ...safeProgress, key_arg_preview: "" };
    expect(present("subagent", [legacy, missingProgress], true).summary).toBeNull();
  });

  it("omits prior continuation ID summaries on replay while retaining task text", () => {
    const id = "a1234567-1234-4234-8234-123456789abc";
    const continuation = {
      ...started("subagent", id),
      delegation_intent: "background_continuation",
    } as const;
    expect(present("subagent", [continuation], true).summary).toBeNull();
    expect(
      present("subagent", [{ ...continuation, delegation_intent: "background_launch" }], true)
        .summary,
    ).toBe(id);
    expect(
      present("subagent", [
        finished("subagent", { delegation_outcome: "background_started", delegation_summary: id }),
      ]).summary,
    ).toBe(id);
    expect(
      present("subagent", [finished("subagent", { is_error: true, delegation_summary: id })])
        .summary,
    ).toBeNull();
    expect(
      present("subagent", [
        finished("subagent", {
          delegation_outcome: "background_continued",
          delegation_summary: id,
        }),
      ]).summary,
    ).toBeNull();
    expect(
      present("subagent", [{ ...continuation, key_arg_preview: "Review store" }], true).summary,
    ).toBe("Review store");
    const pending = {
      ...started("subagent", "child-opaque-id"),
      delegation_summary_verified: true,
    };
    expect(
      presentToolCall({
        call: call("subagent", JSON.stringify({ child_session_id: "child-opaque-id" })),
        events: { started: pending },
        hasResult: false,
        resultText: null,
        resultHasImage: false,
        active: true,
        turnCancelled: false,
      }).summary,
    ).toBeNull();
  });

  it("retains a sanitized task summary when the finished event is the only retained event", () => {
    const item = present("subagent", [
      finished("subagent", {
        delegation_summary: "Review store",
        delegation_outcome: "completed",
        content_preview: "Subagent completed",
      }),
    ]);
    expect(item).toMatchObject({ label: "Subagent completed", summary: "Review store" });
  });

  it("does not interpret a timed-out request as child completion", () => {
    expect(
      present("subagent", [finished("subagent", { completion_status: "timed_out" })]).label,
    ).toBe("Subagent request timed out");
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

  it("does not pair duplicate results within a single assistant batch", () => {
    const messages: Parameters<typeof collectToolResults>[0] = [
      { role: "assistant", content: null, tool_calls: [call("subagent")] },
      { role: "tool", tool_call_id: "call-subagent", content: "first" },
      { role: "tool", tool_call_id: "call-subagent", content: "second" },
    ];
    expect(collectToolResults(messages, 0).has("call-subagent")).toBe(false);
  });

  it("keeps a finished call pending while its live batch has not recorded a result", () => {
    const input = {
      call: call("subagent"),
      events: { finished: finished("subagent") },
      hasResult: false,
      resultText: null,
      resultHasImage: false,
      active: true,
      turnCancelled: false,
    };
    expect(presentToolCall(input)).toMatchObject({ status: "success", resultMayBePending: true });
    expect(presentToolCall({ ...input, active: false })).toMatchObject({
      resultMayBePending: false,
    });
    expect(presentToolCall({ ...input, hasResult: true })).toMatchObject({
      resultMayBePending: false,
    });
  });

  it("does not apply a later reused call ID's lifecycle event to a delegation occurrence", () => {
    const input = {
      call: call("subagent"),
      events: { finished: finished("subagent", { content_preview: "later result" }) },
      hasResult: true,
      resultText: "Error: foreground subagent failed: private detail",
      resultHasImage: false,
      active: false,
      turnCancelled: false,
      occurrence: "log:parent:1:2",
    };
    const earlier = presentToolCall(input);
    const later = presentToolCall({ ...input, occurrence: "log:parent:3:4", resultText: "ok" });
    expect(earlier).toMatchObject({ status: "unknown", resultPreview: null });
    expect(later).toMatchObject({ status: "unknown", resultPreview: null });
    expect(JSON.stringify(earlier)).not.toContain("private detail");
    expect(JSON.stringify(earlier)).not.toContain("later result");
    for (const childStatus of ["failed", "cancelled", "interrupted"] as const) {
      expect(
        presentToolCall({ ...input, resultText: JSON.stringify({ status: childStatus }) }),
      ).toMatchObject({ status: "unknown", resultPreview: null });
    }
  });

  it("does not infer a managed invocation outcome from an unbound response", () => {
    for (const childStatus of ["completed", "failed", "cancelled", "interrupted"]) {
      const presentation = presentToolCall({
        call: call("orchestrator_launch"),
        hasResult: true,
        resultText: JSON.stringify({ status: childStatus }),
        resultHasImage: false,
        active: false,
        turnCancelled: false,
        occurrence: "log:parent:1:2",
      });
      expect(presentation).toMatchObject({ status: "unknown", statusLabel: "Outcome unavailable" });
    }
  });

  it.each(["subagent", "orchestrator_launch"])(
    "does not attach unbound %s events without an occurrence token",
    (name) => {
      const presentation = presentToolCall({
        call: call(name),
        events: { finished: finished(name, { content_preview: "other generation" }) },
        hasResult: true,
        resultText: '{"status":"failed"}',
        resultHasImage: false,
        active: false,
        turnCancelled: false,
        unboundEvents: true,
      });
      expect(presentation).toMatchObject({ status: "unknown", summary: null, resultPreview: null });
      expect(JSON.stringify(presentation)).not.toContain("other generation");
    },
  );
});

describe("tool completion failure classification", () => {
  it.each(["error", "timed_out", "cancelled"] as const)(
    "marks %s completion as failed",
    (completion_status) => {
      expect(
        toolCallFailed({ is_error: false, content_preview: completion_status, completion_status }),
      ).toBe(true);
    },
  );
  it.each(["timed_out", "cancelled", "spawn_error"] as const)(
    "marks %s command as failed",
    (command_status) => {
      expect(toolCallFailed({ is_error: false, content_preview: "", command_status })).toBe(true);
    },
  );
  it("preserves legacy timeout fallback and ordinary completed results", () => {
    expect(
      toolCallFailed({ is_error: false, content_preview: "Command timed out after 1000ms" }),
    ).toBe(true);
    expect(
      toolCallFailed({ is_error: false, content_preview: "exit 7", command_status: "completed" }),
    ).toBe(false);
  });
});
