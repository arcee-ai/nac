import { describe, expect, it } from "vitest";

// The real perfDebug module is inert unless explicitly enabled, so the store
// under test runs against the real thing.
import { mergeWorkspaceStats } from "@/app/services/queries";
import { applyEnvelope, getRuntimeState, resetRuntime } from "@/app/store/runtimeStore";
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

  it("refetches the snapshot when a thread starts so a re-dispatch escapes the previous episode", () => {
    resetRuntime("session-a");
    expect(
      applyEnvelope(
        envelope({
          type: "agent",
          event: {
            type: "thread_started",
            name: "worker",
            action: "run",
            source_threads: [],
          },
        }),
      ),
    ).toBe("snapshot");
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
            type: "orchestrator_compaction_completed",
            compaction_id: "compaction-1",
            reason: "auto",
          },
        }),
      ),
    ).toBe("replace-snapshot");
  });
});

describe("run cancellation", () => {
  it("stops live threads without erasing finished history or reporting failure", () => {
    resetRuntime("session-a");
    applyEnvelope(
      envelope({ type: "run_started", prompt_preview: "work", started_at_epoch_ms: 0 }),
    );
    for (const name of ["finished", "worker-a", "worker-b"]) {
      applyEnvelope(
        envelope({
          type: "agent",
          event: { type: "thread_started", name, action: `run ${name}`, source_threads: [] },
        }),
      );
    }
    applyEnvelope(
      envelope({
        type: "agent",
        event: { type: "thread_log", name: "finished", line: "kept output" },
      }),
    );
    applyEnvelope(
      envelope({
        type: "agent",
        event: {
          type: "thread_finished",
          name: "finished",
          exit_code: 0,
          timed_out: false,
        },
      }),
    );
    applyEnvelope(
      envelope({
        type: "agent",
        event: { type: "model_error", message: "provider refused" },
      }),
    );

    expect(applyEnvelope(envelope({ type: "run_cancelled" }))).toBe("snapshot");
    const state = getRuntimeState();
    expect(state.running).toBe(false);
    expect(state.error).toBeNull();
    expect(state.modelError).toBeNull();
    expect(Object.values(state.threads).every((thread) => thread.status === "finished")).toBe(true);
    expect(Object.values(state.threads).every((thread) => thread.isError === false)).toBe(true);
    expect(state.threads.finished.log).toHaveLength(1);
    expect(state.events.at(-1)).toMatchObject({
      text: "Run cancelled",
      isError: false,
    });
  });

  it("finishes live threads when the run completes without their finish events", () => {
    resetRuntime("session-a");
    applyEnvelope(
      envelope({ type: "run_started", prompt_preview: "work", started_at_epoch_ms: 0 }),
    );
    applyEnvelope(
      envelope({
        type: "agent",
        event: { type: "thread_started", name: "worker", action: "run", source_threads: [] },
      }),
    );
    applyEnvelope(
      envelope({
        type: "agent",
        event: {
          type: "tool_call_started",
          thread_name: "worker",
          call_id: "call-1",
          name: "exec_command",
          args_preview: "ls",
        },
      }),
    );

    expect(applyEnvelope(envelope({ type: "run_completed", response: "ok" }))).toBe("snapshot");
    const state = getRuntimeState();
    expect(state.running).toBe(false);
    expect(state.threads.worker.status).toBe("finished");
    expect(state.threads.worker.isError).toBe(false);
    expect(state.threads.worker.log).toHaveLength(1);
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
