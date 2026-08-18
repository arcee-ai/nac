// Sessions whose run finished while the user was looking elsewhere. The list
// view renders a dot for them until they are opened.

import { createStore } from "@/app/lib/store";
import { isActiveRun } from "@/app/lib/format";
import type { ManagedSessionSummary } from "@/app/types/api";

interface AttentionState {
  flagged: Record<string, boolean>;
}

export const attentionStore = createStore<AttentionState>({ flagged: {} });

const { getState, setState, useStore } = attentionStore;

// Previous run state per session, kept outside the store because it is only an
// implementation detail of the transition detection.
interface ActiveById {
  [id: string]: boolean;
}

let previouslyActive: ActiveById = {};

/**
 * Flag every session that stopped running since the last call, except the one
 * currently open. Call this whenever a fresh session list arrives.
 */
export function trackAttention(sessions: ManagedSessionSummary[], selectedId: string | null): void {
  const nextActive: Record<string, boolean> = {};
  const flagged = { ...getState().flagged };
  let changed = false;

  for (const entry of sessions) {
    const id = entry.summary.session_id;
    const active = isActiveRun(entry.active_run);
    nextActive[id] = active;
    if (previouslyActive[id] === true && !active && id !== selectedId) {
      if (!flagged[id]) {
        flagged[id] = true;
        changed = true;
      }
    }
  }

  previouslyActive = nextActive;
  if (changed) setState({ flagged });
}

export function clearAttention(id: string): void {
  const flagged = getState().flagged;
  if (!flagged[id]) return;
  const next = { ...flagged };
  delete next[id];
  setState({ flagged: next });
}

export const useAttention = (id: string) => useStore((s) => Boolean(s.flagged[id]));
