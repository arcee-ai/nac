// One presentation's attention dots. Durable heartbeat outcomes and human
// acknowledgements survive reconnect through the serving store.
import { createStore, standalonePreferenceStorage } from "@/app/lib/store";
import { isActiveRun } from "@/app/lib/format";
import type { ManagedSessionSummary } from "@/app/types/api";

interface AttentionState {
  flagged: Record<string, boolean>;
  acknowledgements: Record<string, number>;
}
interface ActiveObservation {
  runId: string;
  revision: number;
  waits: number;
}

export function createAttentionStore(_storage?: Pick<Storage, "getItem" | "setItem">) {
  const attentionStore = createStore<AttentionState>({ flagged: {}, acknowledgements: {} });
  const { getState, setState, useStore } = attentionStore;
  let previous: Record<string, ActiveObservation> = {};
  let resultsThrough: Record<string, number> = {};
  let acknowledged: Record<string, number> = {};

  function clearAttentionAll(ids: string[]): void {
    const flagged = { ...getState().flagged };
    const acknowledgements = { ...getState().acknowledgements };
    for (const id of ids) {
      delete flagged[id];
      const sequence = resultsThrough[id] ?? 0;
      if (sequence > (acknowledged[id] ?? 0)) {
        acknowledged[id] = sequence;
        acknowledgements[id] = Math.max(sequence, acknowledgements[id] ?? 0);
      }
    }
    setState({ flagged, acknowledgements });
  }
  function clearAttention(id: string): void {
    clearAttentionAll([id]);
  }

  function trackAttention(sessions: ManagedSessionSummary[], selectedId: string | null): void {
    const next: Record<string, ActiveObservation> = {};
    const flagged = { ...getState().flagged };
    const through: Record<string, number> = {};
    for (const entry of sessions) {
      const id = entry.summary.session_id;
      const results = entry.heartbeat_results ?? [];
      through[id] = results.reduce((maximum, result) => Math.max(maximum, result.sequence), 0);
      const revision = entry.attention_revision ?? 0;
      if (
        results.some(
          (result) =>
            !result.seen &&
            result.sequence > (acknowledged[id] ?? 0) &&
            result.outcome !== "unchanged",
        )
      ) {
        flagged[id] = true;
      }
      if (isActiveRun(entry.active_run) && entry.active_run) {
        next[id] = { runId: entry.active_run.run_id, revision, waits: 0 };
      } else if (previous[id]) {
        const observation = previous[id];
        const result = results.find((item) => item.run_id === observation.runId);
        // The process cache may clear active_run after the list's database
        // snapshot. Wait one poll for canonical settlement before classifying.
        if (
          !result &&
          revision <= observation.revision &&
          observation.waits === 0 &&
          entry.attention_revision !== undefined
        ) {
          next[id] = { ...observation, waits: 1 };
        } else if (!result || result.outcome !== "unchanged") {
          flagged[id] = true;
        }
      }
    }
    previous = next;
    resultsThrough = through;
    setState({ flagged });
    if (selectedId) clearAttention(selectedId);
  }

  function acknowledgeSucceeded(id: string, sequence: number): void {
    const acknowledgements = { ...getState().acknowledgements };
    if ((acknowledgements[id] ?? 0) <= sequence) delete acknowledgements[id];
    setState({ acknowledgements });
  }
  const useAttention = (id: string) => useStore((s) => Boolean(s.flagged[id]));
  const useAnyAttention = (ids: string[]) =>
    useStore((s) => ids.some((id) => Boolean(s.flagged[id])));
  return {
    release: () => {
      previous = {};
      resultsThrough = {};
      acknowledged = {};
      setState({ flagged: {}, acknowledgements: {} });
    },
    attentionStore,
    trackAttention,
    clearAttention,
    useAttention,
    useAnyAttention,
    clearAttentionAll,
    acknowledgeSucceeded,
  };
}
export const {
  release,
  attentionStore,
  trackAttention,
  clearAttention,
  useAttention,
  useAnyAttention,
  clearAttentionAll,
  acknowledgeSucceeded,
} = createAttentionStore(standalonePreferenceStorage);
