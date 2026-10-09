import type { ManagedSessionSummary } from "../types/api";
interface AttentionState {
    flagged: Record<string, boolean>;
}
/** One presentation lifetime; hosted preferences are ephemeral. */
export declare function createAttentionStore(_storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    attentionStore: import("../lib/store").Store<AttentionState>;
    trackAttention: (sessions: ManagedSessionSummary[], selectedId: string | null) => void;
    clearAttention: (id: string) => void;
    useAttention: (id: string) => boolean;
    useAnyAttention: (ids: string[]) => boolean;
    clearAttentionAll: (ids: string[]) => void;
};
export declare const release: () => void, attentionStore: import("../lib/store").Store<AttentionState>, trackAttention: (sessions: ManagedSessionSummary[], selectedId: string | null) => void, clearAttention: (id: string) => void, useAttention: (id: string) => boolean, useAnyAttention: (ids: string[]) => boolean, clearAttentionAll: (ids: string[]) => void;
export {};
