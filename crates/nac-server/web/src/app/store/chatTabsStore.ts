// Which chats have been taken off the tab strip. Closing a tab is a viewing
// preference, not an edit: the chat keeps existing and stays listed in the
// popover, which is where it comes back from.

import { createStore } from "@/app/lib/store";

interface ChatTabsState {
  /** Sessions the user has closed, by id. */
  dismissed: ReadonlySet<string>;
}

export const chatTabsStore = createStore<ChatTabsState>({ dismissed: new Set() }, "chatTabs");

const { setState, useStore } = chatTabsStore;

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

export const useDismissedChatTabs = () => useStore((state) => state.dismissed);
