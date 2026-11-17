import { createStore, standalonePreferenceStorage } from "@/app/lib/store";

import type { InboxReadState } from "./inboxModel";

/**
 * Which finished/failed runs this device has seen. Per device by design: it
 * lives in local preference storage, never on the server. On first use the
 * baseline is "now", so a fresh browser shows only recent outcomes.
 */
const KEY = "nac.inbox.read.v1";
/** Bound the stored map; the newest marks win. */
const MAX_MARKS = 500;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function load(storage: Storage, now: number): InboxReadState {
  try {
    const raw = storage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<InboxReadState>;
      if (typeof parsed.since === "number" && parsed.runs && typeof parsed.runs === "object") {
        return { since: parsed.since, runs: { ...parsed.runs } as Record<string, string> };
      }
    }
  } catch {
    // Unreadable or blocked storage: start from now, below.
  }
  const fresh = { since: now, runs: {} };
  save(storage, fresh);
  return fresh;
}

function save(storage: Storage, state: InboxReadState): void {
  try {
    storage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Read marks are a convenience; the Inbox still works without them.
  }
}

export function createInboxReadStore(
  storage: Storage = standalonePreferenceStorage,
  now = Date.now(),
) {
  const store = createStore<InboxReadState>(load(storage, now), "inbox-read");
  const commit = (runs: Record<string, string>) => {
    const entries = Object.entries(runs);
    const bounded =
      entries.length > MAX_MARKS ? Object.fromEntries(entries.slice(-MAX_MARKS)) : runs;
    const next = { ...store.getState(), runs: bounded };
    store.setState(next);
    save(storage, next);
  };
  return {
    useReadState: () => store.useStore(),
    getState: store.getState,
    markRead(sessionId: string, runId: string) {
      if (store.getState().runs[sessionId] === runId) return;
      const runs = { ...store.getState().runs };
      delete runs[sessionId];
      runs[sessionId] = runId;
      commit(runs);
    },
    markAllRead(marks: ReadonlyArray<{ sessionId: string; runId: string }>) {
      if (marks.length === 0) return;
      const runs = { ...store.getState().runs };
      for (const mark of marks) {
        delete runs[mark.sessionId];
        runs[mark.sessionId] = mark.runId;
      }
      commit(runs);
    },
  };
}

export type InboxReadStore = ReturnType<typeof createInboxReadStore>;

let shared: InboxReadStore | null = null;
/** The app's one read store (created lazily so tests can supply storage). */
export function inboxReadStore(): InboxReadStore {
  shared ??= createInboxReadStore();
  return shared;
}
