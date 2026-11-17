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
/** One presentation lifetime; hosted preferences are ephemeral. */
export declare function createChatTabsStore(storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    chatTabsStore: import("../lib/store").Store<ChatTabsState>;
    dismissChatTab: (sessionId: string) => void;
    restoreChatTab: (sessionId: string) => void;
    setChatTabOrder: (projectId: string, sessionIds: readonly string[]) => void;
    pruneChatTabs: (sessionIds: Iterable<string>, projectIds: Iterable<string>) => void;
    useDismissedChatTabs: () => ReadonlySet<string>;
    useChatTabOrder: (projectId: string | null) => readonly string[];
};
export declare const release: () => void, chatTabsStore: import("../lib/store").Store<ChatTabsState>, dismissChatTab: (sessionId: string) => void, restoreChatTab: (sessionId: string) => void, setChatTabOrder: (projectId: string, sessionIds: readonly string[]) => void, pruneChatTabs: (sessionIds: Iterable<string>, projectIds: Iterable<string>) => void, useDismissedChatTabs: () => ReadonlySet<string>, useChatTabOrder: (projectId: string | null) => readonly string[];
export {};
