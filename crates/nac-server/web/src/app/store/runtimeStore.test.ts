import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyEnvelope,
  getRuntimeState,
  resetRuntime,
  runtimeStore,
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
});
