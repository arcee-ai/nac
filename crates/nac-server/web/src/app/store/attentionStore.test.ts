import { describe, expect, it } from "vitest";
import { createAttentionStore } from "./attentionStore";
import type { ManagedSessionSummary } from "@/app/types/api";

const summary = (
  id: string,
  revision: number,
  active: string | null,
  outcome?: "unchanged" | "meaningful" | "failed" | "unknown",
  sequence = 1,
) =>
  ({
    summary: { session_id: id },
    attention_revision: revision,
    active_run: active ? { run_id: active, started_at_epoch_ms: 1 } : null,
    heartbeat_results: outcome
      ? [
          {
            run_id: "heartbeat-run",
            occurrence_id: "occurrence",
            schedule_id: "schedule",
            outcome,
            sequence,
            seen: false,
          },
        ]
      : [],
  }) as ManagedSessionSummary;

describe("durable heartbeat attention", () => {
  it("does not mistake cache-before-settlement ordering for an ordinary completion", () => {
    const owner = createAttentionStore();
    owner.trackAttention([summary("chat", 1, "heartbeat-run")], null);
    owner.trackAttention([summary("chat", 1, null)], null);
    expect(owner.attentionStore.getState().flagged.chat).toBeUndefined();
    owner.trackAttention([summary("chat", 2, null, "unchanged")], null);
    expect(owner.attentionStore.getState().flagged.chat).toBeUndefined();
    owner.trackAttention([summary("chat", 2, "human-run", "unchanged")], null);
    owner.trackAttention([summary("chat", 3, null, "unchanged")], null);
    expect(owner.attentionStore.getState().flagged.chat).toBe(true);
  });
  it("shows unknown/failure after reconnect and acknowledges only the sequence opened by the human", () => {
    const owner = createAttentionStore();
    owner.trackAttention([summary("chat", 2, null, "failed", 2)], null);
    expect(owner.attentionStore.getState().flagged.chat).toBe(true);
    owner.clearAttention("chat");
    expect(owner.attentionStore.getState().acknowledgements).toEqual({ chat: 2 });
    owner.trackAttention([summary("chat", 2, null, "failed", 2)], null);
    expect(owner.attentionStore.getState().flagged.chat).toBeUndefined();
    owner.trackAttention([summary("chat", 3, null, "unknown", 3)], null);
    expect(owner.attentionStore.getState().flagged.chat).toBe(true);
    owner.clearAttentionAll(["chat"]);
    owner.acknowledgeSucceeded("chat", 2);
    expect(owner.attentionStore.getState().acknowledgements).toEqual({ chat: 3 });
    owner.acknowledgeSucceeded("chat", 3);
    expect(owner.attentionStore.getState().acknowledgements).toEqual({});
  });
});
