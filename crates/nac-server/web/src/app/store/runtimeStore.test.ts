import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/perfDebug", () => ({
  perfEpoch: vi.fn(),
  perfMark: vi.fn(),
  perfRender: vi.fn(),
  perfTime: (_name: string, run: () => unknown) => run(),
}));

import { mergeWorkspaceStats } from "@/app/services/queries";
import {
  applyEnvelope,
  getRuntimeState,
  resetRuntime,
} from "@/app/store/runtimeStore";
import type {
  ManagedSessionSummary,
  SessionEventEnvelope,
} from "@/app/types/api";

function envelope(event: unknown): SessionEventEnvelope {
  return { sequence_id: 1, event } as SessionEventEnvelope;
}

function summary(
  id: string,
  title: string,
  changed?: number,
): ManagedSessionSummary {
  return {
    summary: { session_id: id, title } as ManagedSessionSummary["summary"],
    active: false,
    ...(changed === undefined
      ? {}
      : { workspace_diff: { added: changed, removed: 0 } }),
  } as ManagedSessionSummary;
}

describe("canonical refresh classification", () => {
  it("routes transcript commits to messages without a redundant assistant snapshot", () => {
    resetRuntime("session-a");
    expect(
      applyEnvelope(
        envelope({ type: "transcript_appended", transcript_len: 42 }),
      ),
    ).toBe("messages");
    expect(
      applyEnvelope(
        envelope({
          type: "agent",
          event: { type: "assistant_message", content_preview: "done" },
        }),
      ),
    ).toBe("none");
  });

  it("distinguishes normal lifecycle snapshots from destructive fences", () => {
    resetRuntime("session-a");
    expect(
      applyEnvelope(envelope({ type: "run_completed", response: "ok" })),
    ).toBe("snapshot");
    expect(
      applyEnvelope(envelope({ type: "transcript_reverted", transcript_len: 2 })),
    ).toBe("replace-snapshot");
    expect(
      applyEnvelope(
        envelope({
          type: "agent",
          event: {
            type: "orchestrator_compaction_completed",
            summary_tokens: 10,
          },
        }),
      ),
    ).toBe("replace-snapshot");
  });
});

describe("run cancellation", () => {
  it("stops live threads without erasing finished history or reporting failure", () => {
    resetRuntime("session-a");
    applyEnvelope(envelope({ type: "run_started", prompt_preview: "work" }));
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
    applyEnvelope(envelope({ type: "run_started", prompt_preview: "work" }));
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
    applyEnvelope(envelope({ type: "run_started", prompt_preview: "work" }));
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
    const stats = [
      summary("a", "stale title", 7),
      summary("deleted", "must not return", 9),
    ];

    const merged = mergeWorkspaceStats(base, stats);
    expect(merged.map((entry) => entry.summary.title)).toEqual([
      "new title",
      "second",
    ]);
    expect(merged.map((entry) => entry.workspace_diff)).toEqual([
      { added: 7, removed: 0 },
      undefined,
    ]);
    expect(merged.map((entry) => entry.summary.session_id)).toEqual(["a", "b"]);
  });
});
