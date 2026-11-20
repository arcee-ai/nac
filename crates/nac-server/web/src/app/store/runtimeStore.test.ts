import { describe, expect, it } from "vitest";

// The real perfDebug module is inert unless explicitly enabled, so the store
// under test runs against the real thing.
import { mergeWorkspaceStats } from "@/app/services/queries";
import {
  applyAssistantDelta,
  applyEnvelope,
  getRuntimeState,
  resetRuntime,
} from "@/app/store/runtimeStore";
import type { ManagedSessionSummary, SessionEvent, SessionEventEnvelope } from "@/app/types/api";

function envelope(event: SessionEvent): SessionEventEnvelope {
  // SAFETY: test fixture — the store under test reads only the event payload
  // the fixtures provide; the remaining envelope fields are omitted.
  return { sequence_id: 1, event } as SessionEventEnvelope;
}

function summary(id: string, title: string, changed?: number): ManagedSessionSummary {
  // SAFETY: test fixture — the merge reads only summary.session_id/title and
  // moves workspace_diff opaquely; the remaining summary fields are omitted.
  const fixture = {
    summary: { session_id: id, title } as ManagedSessionSummary["summary"],
    active: false,
  } as ManagedSessionSummary;
  if (changed !== undefined) {
    fixture.workspace_diff = {
      total_additions: changed,
      total_deletions: 0,
      error: null,
    };
  }
  return fixture;
}

describe("canonical refresh classification", () => {
  it("replaces an abandoned partial stream when a model retry begins", () => {
    resetRuntime("session-a");
    applyAssistantDelta({ text: "abandoned", reasoning: "old thoughts" });
    applyAssistantDelta({ reset: true, retry_attempt: 2 });
    expect(getRuntimeState()).toMatchObject({
      streamText: "",
      streamReasoning: "",
      modelRetryAttempt: 2,
    });

    applyAssistantDelta({ text: "replacement" });
    expect(getRuntimeState()).toMatchObject({
      streamText: "replacement",
      streamReasoning: "",
      modelRetryAttempt: 2,
    });
  });

  it("routes transcript commits to messages without a redundant assistant snapshot", () => {
    resetRuntime("session-a");
    expect(applyEnvelope(envelope({ type: "transcript_appended", transcript_len: 42 }))).toBe(
      "messages",
    );
    expect(
      applyEnvelope(
        envelope({
          type: "agent",
          event: { type: "assistant_message", content: "done" },
        }),
      ),
    ).toBe("none");
  });

  it("distinguishes normal lifecycle snapshots from destructive fences", () => {
    resetRuntime("session-a");
    expect(applyEnvelope(envelope({ type: "run_completed", response: "ok" }))).toBe("snapshot");
    expect(applyEnvelope(envelope({ type: "transcript_reverted", transcript_len: 2 }))).toBe(
      "replace-snapshot",
    );
    expect(
      applyEnvelope(
        envelope({
          type: "agent",
          event: {
            type: "compaction_completed",
            compaction_id: "compaction-1",
            reason: "auto",
          },
        }),
      ),
    ).toBe("replace-snapshot");
  });

  it("tracks neutral compaction events and settles the activity", () => {
    resetRuntime("session-a");
    const base = { compaction_id: "compaction-1", reason: "auto" } as const;
    applyEnvelope(envelope({ type: "agent", event: { type: "compaction_started", ...base } }));
    expect(getRuntimeState().activity).toBe("Compacting context…");
    applyEnvelope(
      envelope({
        type: "agent",
        event: { type: "compaction_skipped", cause: "already_compacted", ...base },
      }),
    );
    expect(getRuntimeState().activity).toBe("");
    expect(getRuntimeState().events.at(-1)).toMatchObject({
      kind: "compaction",
      text: "Compaction skipped: already_compacted",
      isError: false,
    });
    applyEnvelope(
      envelope({
        type: "agent",
        event: { type: "compaction_failed", failure: "summary_rejected", ...base },
      }),
    );
    expect(getRuntimeState().events.at(-1)).toMatchObject({
      kind: "compaction",
      text: "Compaction failed: summary_rejected",
      isError: true,
    });
  });

  it("retains and settles safe primary tool overlays by call identity", () => {
    resetRuntime("session-a");
    applyEnvelope(
      envelope({
        type: "agent",
        event: {
          type: "tool_call_started",
          call_id: "call-primary",
          name: "read",
          args_preview: '{"operation":"read"}',
          key_arg_preview: "src/lib.rs",
        },
      }),
    );
    applyEnvelope(
      envelope({
        type: "agent",
        event: {
          type: "tool_call_finished",
          call_id: "call-primary",
          name: "read",
          content_preview: "src/lib.rs",
          is_error: false,
        },
      }),
    );

    expect(getRuntimeState().primaryToolEvents).toHaveLength(2);
    expect(getRuntimeState().primaryToolEvents.map((event) => event.type)).toEqual([
      "tool_call_started",
      "tool_call_finished",
    ]);
    applyEnvelope(envelope({ type: "transcript_reverted", transcript_len: 0 }));
    expect(getRuntimeState().primaryToolEvents).toEqual([]);
  });

  it("coalesces repeated validated subagent progress without adding activity entries", () => {
    resetRuntime("session-a");
    const start = {
      type: "tool_call_started",
      call_id: "child-call",
      name: "subagent",
      args_preview: "safe",
      key_arg_preview: "Review store",
    } as const;
    const progress = {
      ...start,
      args_preview: "",
      key_arg_preview: "Review store",
      delegation_intent: "background_launch",
    } as const;
    applyEnvelope(envelope({ type: "agent", event: start }));
    const activityCount = getRuntimeState().events.length;
    const verified = { ...start, delegation_summary_verified: true } as const;
    applyEnvelope(envelope({ type: "agent", event: verified }));
    expect(getRuntimeState().events).toHaveLength(activityCount);
    expect(getRuntimeState().primaryToolEvents).toEqual([verified]);
    applyEnvelope(envelope({ type: "agent", event: progress }));
    applyEnvelope(envelope({ type: "agent", event: progress }));
    expect(getRuntimeState().events).toHaveLength(activityCount);
    expect(getRuntimeState().primaryToolEvents).toEqual([progress]);
    applyEnvelope(
      envelope({
        type: "agent",
        event: {
          type: "tool_call_finished",
          call_id: "child-call",
          name: "subagent",
          content_preview: "Subagent started in background",
          is_error: false,
          delegation_outcome: "background_started",
          execution_duration_ms: 123,
        },
      }),
    );
    expect(getRuntimeState().primaryToolEvents).toHaveLength(2);
  });

  it("reports a skipped MCP integration for a direct session", () => {
    resetRuntime("session-a");
    applyEnvelope(
      envelope({
        type: "agent",
        event: {
          type: "mcp_server_skipped",
          server_name: "docs",
          reason: "connection failed",
        },
      }),
    );
    expect(getRuntimeState().events.at(-1)).toMatchObject({
      kind: "mcp",
      text: "MCP docs: connection failed",
      isError: true,
    });
  });

  it("surfaces bounded MCP observations in the event view", () => {
    resetRuntime("session-a");
    applyEnvelope(
      envelope({
        type: "agent",
        event: {
          type: "mcp_notification",
          server_name: "docs",
          kind: "catalog_refresh_failed",
          message: "tool refresh failed; retaining the last-known-good catalog",
        },
      }),
    );

    const state = getRuntimeState();
    expect(state.events.at(-1)).toMatchObject({
      kind: "mcp",
      text: "MCP docs: tool refresh failed; retaining the last-known-good catalog",
      isError: true,
    });
  });
});

describe("run cancellation", () => {
  it("clears errors when a direct run is cancelled", () => {
    resetRuntime("session-a");
    applyEnvelope(
      envelope({ type: "run_started", prompt_preview: "work", started_at_epoch_ms: 0 }),
    );
    applyEnvelope(
      envelope({ type: "agent", event: { type: "model_error", message: "provider refused" } }),
    );
    expect(applyEnvelope(envelope({ type: "run_cancelled" }))).toBe("snapshot");
    expect(getRuntimeState()).toMatchObject({ running: false, error: null, modelError: null });
    expect(getRuntimeState().events.at(-1)).toMatchObject({
      text: "Run cancelled",
      isError: false,
    });
  });

  it("keeps provider failures visible for failed runs", () => {
    resetRuntime("session-a");
    applyEnvelope(
      envelope({ type: "run_started", prompt_preview: "work", started_at_epoch_ms: 0 }),
    );
    applyEnvelope(
      envelope({
        type: "agent",
        event: { type: "model_error", message: "provider refused" },
      }),
    );
    applyEnvelope(envelope({ type: "run_failed", message: "run failed" }));

    expect(getRuntimeState().error).toBe("provider refused");
  });
});

describe("workspace statistics merge", () => {
  it("copies only workspace stats into current base ids", () => {
    const base = [summary("a", "new title"), summary("b", "second")];
    const stats = [summary("a", "stale title", 7), summary("deleted", "must not return", 9)];

    const merged = mergeWorkspaceStats(base, stats);
    expect(merged.map((entry) => entry.summary.title)).toEqual(["new title", "second"]);
    expect(merged.map((entry) => entry.workspace_diff)).toEqual([
      { total_additions: 7, total_deletions: 0, error: null },
      undefined,
    ]);
    expect(merged.map((entry) => entry.summary.session_id)).toEqual(["a", "b"]);
  });
});
