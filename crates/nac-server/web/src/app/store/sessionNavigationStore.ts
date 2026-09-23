import { parseStoreTime } from "@/app/lib/format";
import { createStore } from "@/app/lib/store";

export interface SessionNavigationState {
  /** Browser-only shortcuts; these never update server presentation. */
  pinned: ReadonlySet<string>;
  /** Last authoritative session update observed while the session was open. */
  lastViewedAt: Readonly<Record<string, string>>;
}

interface StoredSessionNavigation {
  pinned: string[];
  lastViewedAt: Record<string, string>;
}

const STORAGE_KEY = "nac.sessionNavigation";

const empty = (): SessionNavigationState => ({ pinned: new Set(), lastViewedAt: {} });

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export function restoreSessionNavigation(raw: string | null): SessionNavigationState {
  if (!raw) return empty();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty();
    const record = parsed as Record<string, unknown>;
    const viewed =
      record.lastViewedAt && typeof record.lastViewedAt === "object"
        ? Object.fromEntries(
            Object.entries(record.lastViewedAt).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : {};
    return { pinned: new Set(strings(record.pinned)), lastViewedAt: viewed };
  } catch {
    return empty();
  }
}

export function serializeSessionNavigation(state: SessionNavigationState): string {
  const stored: StoredSessionNavigation = {
    pinned: [...state.pinned],
    lastViewedAt: { ...state.lastViewedAt },
  };
  return JSON.stringify(stored);
}

function restore(): SessionNavigationState {
  try {
    return restoreSessionNavigation(localStorage.getItem(STORAGE_KEY));
  } catch {
    return empty();
  }
}

export const sessionNavigationStore = createStore<SessionNavigationState>(
  restore(),
  "sessionNavigation",
);

const { getState, setState, subscribe, useStore } = sessionNavigationStore;

subscribe(() => {
  try {
    localStorage.setItem(STORAGE_KEY, serializeSessionNavigation(getState()));
  } catch {
    // A full or forbidden browser store loses shortcuts, never server state.
  }
});

export function toggleSessionNavigationPin(sessionId: string): void {
  setState((state) => {
    const pinned = new Set(state.pinned);
    if (!pinned.delete(sessionId)) pinned.add(sessionId);
    return { pinned };
  });
}

export function markSessionViewed(sessionId: string, updatedAt: string): void {
  const nextTime = parseStoreTime(updatedAt);
  if (!Number.isFinite(nextTime)) return;
  setState((state) => {
    const current = state.lastViewedAt[sessionId];
    if (current && parseStoreTime(current) >= nextTime) return null;
    return { lastViewedAt: { ...state.lastViewedAt, [sessionId]: updatedAt } };
  });
}

/** Keep browser presentation about sessions that still exist. */
export function pruneSessionNavigation(sessionIds: Iterable<string>): void {
  const live = new Set(sessionIds);
  setState((state) => {
    const pinned = new Set([...state.pinned].filter((id) => live.has(id)));
    const lastViewedAt = Object.fromEntries(
      Object.entries(state.lastViewedAt).filter(([id]) => live.has(id)),
    );
    if (
      pinned.size === state.pinned.size &&
      Object.keys(lastViewedAt).length === Object.keys(state.lastViewedAt).length
    ) {
      return null;
    }
    return { pinned, lastViewedAt };
  });
}

export const useSessionNavigationPins = () => useStore((state) => state.pinned);
export const useSessionViewedAt = (sessionId: string) =>
  useStore((state) => state.lastViewedAt[sessionId]);
