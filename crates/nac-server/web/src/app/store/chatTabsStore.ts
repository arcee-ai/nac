// How the tab strip above a transcript is arranged: which chats have been taken
// off it, and what order the rest sit in. Both are viewing preferences rather
// than edits — the chats keep existing and stay listed in the popover, which is
// where a closed one comes back from — so they live here and not on the server.
//
// They do outlive the page, though: a strip the user arranged and then found
// undone by a refresh would be worse than one that never moved.

import { createStore } from "@/app/lib/store";

interface ChatTabsState {
  /** Sessions the user has closed, by id. */
  dismissed: ReadonlySet<string>;
  /**
   * Left-to-right tab order per project, by session id, for the projects whose
   * strip has been rearranged by hand. Everywhere else chats are listed by when
   * they were last used; a strip of tabs is furniture, so it stays put.
   */
  order: Readonly<Record<string, readonly string[]>>;
}

const STORAGE_KEY = "nac.chatTabs";

const empty = (): ChatTabsState => ({ dismissed: new Set(), order: {} });

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/**
 * Anything unreadable is treated as no preference at all: the strip falls back
 * to its default arrangement, which is never wrong, only unasked for.
 */
function restore(): ChatTabsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty();
    const { dismissed, order } = parsed as Record<string, unknown>;
    return {
      dismissed: new Set(strings(dismissed)),
      order: Object.fromEntries(
        Object.entries(order && typeof order === "object" ? order : {}).map(([projectId, ids]) => [
          projectId,
          strings(ids),
        ]),
      ),
    };
  } catch {
    return empty();
  }
}

export const chatTabsStore = createStore<ChatTabsState>(restore(), "chatTabs");

const { getState, setState, subscribe, useStore } = chatTabsStore;

subscribe(() => {
  const { dismissed, order } = getState();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dismissed: [...dismissed], order }));
  } catch {
    // Full or forbidden storage costs the arrangement its memory, nothing more.
  }
});

export function dismissChatTab(sessionId: string): void {
  setState((state) => {
    if (state.dismissed.has(sessionId)) return null;
    const dismissed = new Set(state.dismissed);
    dismissed.add(sessionId);
    return { dismissed };
  });
}

/** Puts a chat back on the strip, which is what opening it means. */
export function restoreChatTab(sessionId: string): void {
  setState((state) => {
    if (!state.dismissed.has(sessionId)) return null;
    const dismissed = new Set(state.dismissed);
    dismissed.delete(sessionId);
    return { dismissed };
  });
}

export function setChatTabOrder(projectId: string, sessionIds: readonly string[]): void {
  setState((state) => ({ order: { ...state.order, [projectId]: sessionIds } }));
}

/**
 * Forgets chats and projects that are gone, so what is kept on disk stays about
 * things that still exist. Callers must have the real lists in hand: pruning
 * against a half-loaded one would throw the arrangement away.
 */
export function pruneChatTabs(sessionIds: Iterable<string>, projectIds: Iterable<string>): void {
  const liveSessions = new Set(sessionIds);
  const liveProjects = new Set(projectIds);
  setState((state) => {
    const dismissed = new Set([...state.dismissed].filter((id) => liveSessions.has(id)));
    const order: Record<string, readonly string[]> = {};
    for (const [projectId, ids] of Object.entries(state.order)) {
      if (!liveProjects.has(projectId)) continue;
      order[projectId] = ids.filter((id) => liveSessions.has(id));
    }
    const unchanged =
      dismissed.size === state.dismissed.size &&
      Object.keys(order).length === Object.keys(state.order).length &&
      Object.entries(order).every(
        ([projectId, ids]) => ids.length === state.order[projectId]?.length,
      );
    return unchanged ? null : { dismissed, order };
  });
}

export const useDismissedChatTabs = () => useStore((state) => state.dismissed);

const NO_ORDER: readonly string[] = [];

/** Empty until the project's strip has been rearranged. */
export const useChatTabOrder = (projectId: string | null) =>
  useStore((state) => (projectId ? (state.order[projectId] ?? NO_ORDER) : NO_ORDER));
