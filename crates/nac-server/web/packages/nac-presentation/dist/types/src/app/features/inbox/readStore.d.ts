import type { InboxReadState } from "./inboxModel";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export declare function createInboxReadStore(storage?: Storage, now?: number): {
    useReadState: () => InboxReadState;
    getState: () => InboxReadState;
    markRead(sessionId: string, runId: string): void;
    markAllRead(marks: ReadonlyArray<{
        sessionId: string;
        runId: string;
    }>): void;
};
export type InboxReadStore = ReturnType<typeof createInboxReadStore>;
/** The app's one read store (created lazily so tests can supply storage). */
export declare function inboxReadStore(): InboxReadStore;
export {};
