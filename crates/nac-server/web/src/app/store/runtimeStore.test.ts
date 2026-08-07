import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyAssistantDelta,
  applyEnvelope,
  getRuntimeState,
  resetRuntime,
  runtimeStore,
  setStreamStatus,
  syncRunFromSnapshot,
} from "@/app/store/runtimeStore";
import type { SessionEventEnvelope } from "@/app/types/api";

function envelope(
  sequenceId: number,
  event: SessionEventEnvelope["event"],
): SessionEventEnvelope {
  return {
    session_id: "session-1",
    epoch_id: "epoch-1",
    sequence_id: sequenceId,
    run_id: "run-1",
    event,
  };
}

afterEach(() => resetRuntime(null));

describe("runtime external store", () => {
  it("notifies subscribers while folding run and thread events", () => {
    resetRuntime("session-1");
    const listener = vi.fn();
    const unsubscribe = runtimeStore.subscribe(listener);

    expect(
      applyEnvelope(
        envelope(1, {
          type: "run_started",
          prompt_preview: "Implement tests",
          started_at_epoch_ms: 1,
        }),
      ),
    ).toBe(true);
    expect(
      applyEnvelope(
        envelope(2, {
          type: "agent",
          event: {
            type: "thread_started",
            name: "frontend",
            action: "Add Vitest",
            source_threads: [],
          },
        }),
      ),
    ).toBe(false);

    expect(listener).toHaveBeenCalled();
    expect(getRuntimeState()).toMatchObject({
      running: true,
      activity: "Thread frontend: Add Vitest",
      threads: {
        frontend: {
          status: "running",
          action: "Add Vitest",
          isError: false,
        },
      },
    });
    expect(getRuntimeState().events.map((event) => event.seq)).toEqual([1, 2]);

    unsubscribe();
  });

  it("projects orchestrator guidance lifecycle without creating a user turn", () => {
    resetRuntime("session-1");
    applyEnvelope(envelope(1, {
      type: "agent",
      event: {
        type: "orchestrator_steering_queued",
        steering_id: 9,
        instruction_preview: "focus tests",
      },
    }));
    expect(getRuntimeState().guidance).toMatchObject({
      steeringId: 9,
      status: "queued",
    });

    applyEnvelope(envelope(2, {
      type: "agent",
      event: {
        type: "orchestrator_steering_delivered",
        steering_id: 9,
        instruction_preview: "focus tests",
      },
    }));
    expect(getRuntimeState().guidance?.status).toBe("delivered");
    expect(getRuntimeState().optimisticUserPrompt).toBeNull();
  });

  it("streams only the active run and provider call", () => {
    resetRuntime("session-1");
    syncRunFromSnapshot({
      run_id: "run-1",
      prompt_preview: "hello",
      started_at_epoch_ms: 1,
    });

    applyAssistantDelta({
      run_id: "run-1",
      model_call_id: "call-1",
      thread_name: null,
      reasoning: "thinking ",
    });
    applyAssistantDelta({
      run_id: "run-1",
      model_call_id: "call-1",
      thread_name: null,
      text: "answer",
    });
    applyAssistantDelta({
      run_id: "run-1",
      model_call_id: "other-call",
      thread_name: null,
      text: "stale",
    });

    expect(getRuntimeState()).toMatchObject({
      streamText: "answer",
      streamReasoning: "thinking ",
      streamModelCallId: "call-1",
    });

    applyEnvelope(envelope(2, { type: "transcript_appended", transcript_len: 2 }));
    applyAssistantDelta({
      run_id: "run-1",
      model_call_id: "call-1",
      thread_name: null,
      text: " late",
    });
    applyAssistantDelta({
      run_id: "run-1",
      model_call_id: "call-2",
      thread_name: null,
      text: "next call",
    });
    expect(getRuntimeState()).toMatchObject({
      streamText: "next call",
      streamReasoning: "",
      streamModelCallId: "call-2",
    });
  });

  it("hands a queued turn to the successor without inheriting predecessor output", () => {
    resetRuntime("session-1");
    applyEnvelope(envelope(1, {
      type: "run_started",
      prompt_preview: "first",
      started_at_epoch_ms: 1,
    }));
    applyAssistantDelta({
      run_id: "run-1",
      model_call_id: "call-old",
      thread_name: null,
      text: "first answer",
    });
    applyEnvelope(envelope(2, { type: "run_completed", response: "first answer" }));
    applyEnvelope(envelope(3, {
      type: "queued_run_admitted",
      queued_run_id: "queued-1",
      run_id: "run-2",
    }));
    const successor = envelope(4, {
      type: "run_started",
      prompt_preview: "next",
      submitted_user_message: {
        run_id: "run-2",
        content: "next",
        submitted_at_epoch_ms: 2,
      },
      started_at_epoch_ms: 2,
    });
    successor.run_id = "run-2";
    applyEnvelope(successor);

    expect(getRuntimeState()).toMatchObject({
      running: true,
      streamRunId: "run-2",
      streamText: "",
      admittedQueuedRunId: "queued-1",
      optimisticUserPrompt: "next",
    });
    applyAssistantDelta({
      run_id: "run-1",
      model_call_id: "call-old",
      thread_name: null,
      text: "late",
    });
    expect(getRuntimeState().streamText).toBe("");
  });

  it("discards cancelled output and rejects a late delta after the next run starts", () => {
    resetRuntime("session-1");
    applyEnvelope(envelope(1, {
      type: "run_started",
      prompt_preview: "first",
      started_at_epoch_ms: 1,
    }));
    applyAssistantDelta({
      run_id: "run-1",
      model_call_id: "call-old",
      thread_name: null,
      text: "discard me",
    });
    applyEnvelope(envelope(2, { type: "run_cancelled" }));
    expect(getRuntimeState()).toMatchObject({
      running: false,
      streamText: "",
      streamReasoning: "",
      streamRunId: null,
    });

    const next = envelope(3, {
      type: "run_started",
      prompt_preview: "second",
      started_at_epoch_ms: 2,
    });
    next.run_id = "run-2";
    applyEnvelope(next);
    applyAssistantDelta({
      run_id: "run-1",
      model_call_id: "call-old",
      thread_name: null,
      text: "late prior run",
    });
    applyAssistantDelta({
      run_id: "run-2",
      model_call_id: "call-new",
      thread_name: null,
      text: "current",
    });
    expect(getRuntimeState().streamText).toBe("current");
  });

  it("clears failed and reconnect-invalidated partial buffers", () => {
    resetRuntime("session-1");
    syncRunFromSnapshot({
      run_id: "run-1",
      prompt_preview: "hello",
      started_at_epoch_ms: 1,
    });
    applyAssistantDelta({
      run_id: "run-1",
      model_call_id: "call-1",
      thread_name: null,
      text: "partial",
    });
    setStreamStatus("reconnecting");
    syncRunFromSnapshot({
      run_id: "run-1",
      prompt_preview: "hello",
      started_at_epoch_ms: 1,
    });
    applyAssistantDelta({
      run_id: "run-1",
      model_call_id: "call-1",
      thread_name: null,
      text: "late after reconnect",
    });
    expect(getRuntimeState().streamText).toBe("");

    applyAssistantDelta({
      run_id: "run-1",
      model_call_id: "call-2",
      thread_name: null,
      text: "fresh",
    });
    applyEnvelope(envelope(4, { type: "run_failed", message: "run failed" }));
    expect(getRuntimeState()).toMatchObject({
      running: false,
      streamText: "",
      streamReasoning: "",
      streamRunId: null,
    });
  });
});
