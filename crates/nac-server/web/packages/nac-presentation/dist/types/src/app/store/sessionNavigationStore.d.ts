export interface SessionNavigationState {
    /** Browser-only shortcuts; these never update server presentation. */
    pinned: ReadonlySet<string>;
    /** Last authoritative session update observed while the session was open. */
    lastViewedAt: Readonly<Record<string, string>>;
}
/** One presentation lifetime; hosted preferences are ephemeral. */
export declare function createSessionNavigationStore(storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    restoreSessionNavigation: (raw: string | null) => SessionNavigationState;
    serializeSessionNavigation: (state: SessionNavigationState) => string;
    sessionNavigationStore: import("../lib/store").Store<SessionNavigationState>;
    toggleSessionNavigationPin: (sessionId: string) => void;
    markSessionViewed: (sessionId: string, updatedAt: string) => void;
    pruneSessionNavigation: (sessionIds: Iterable<string>) => void;
    useSessionNavigationPins: () => ReadonlySet<string>;
    useSessionViewedAt: (sessionId: string) => string;
};
export declare const release: () => void, restoreSessionNavigation: (raw: string | null) => SessionNavigationState, serializeSessionNavigation: (state: SessionNavigationState) => string, sessionNavigationStore: import("../lib/store").Store<SessionNavigationState>, toggleSessionNavigationPin: (sessionId: string) => void, markSessionViewed: (sessionId: string, updatedAt: string) => void, pruneSessionNavigation: (sessionIds: Iterable<string>) => void, useSessionNavigationPins: () => ReadonlySet<string>, useSessionViewedAt: (sessionId: string) => string;
