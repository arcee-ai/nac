import type { InboxReadState } from "./inboxModel";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export declare function createInboxReadStore(storage?: Storage, now?: number): {
    firstSeen: Map<string, number>;
    release(): void;
    useReadState: () => InboxReadState;
    getState: () => InboxReadState;
    markRead(sessionId: string, runId: string): void;
    markAllRead(marks: ReadonlyArray<{
        sessionId: string;
        runId: string;
    }>): void;
};
export type InboxReadStore = ReturnType<typeof createInboxReadStore>;
export declare const standaloneInboxReadStore: {
    firstSeen: Map<string, number>;
    release(): void;
    useReadState: () => InboxReadState;
    getState: () => InboxReadState;
    markRead(sessionId: string, runId: string): void;
    markAllRead(marks: ReadonlyArray<{
        sessionId: string;
        runId: string;
    }>): void;
};
export {};
