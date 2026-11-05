import type { ManagedSessionSummary } from "../types/api";
interface AttentionState {
    flagged: Record<string, boolean>;
    acknowledgements: Record<string, number>;
}
export declare function createAttentionStore(_storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    attentionStore: import("../lib/store").Store<AttentionState>;
    trackAttention: (sessions: ManagedSessionSummary[], selectedId: string | null) => void;
    clearAttention: (id: string) => void;
    useAttention: (id: string) => boolean;
    useAnyAttention: (ids: string[]) => boolean;
    clearAttentionAll: (ids: string[]) => void;
    acknowledgeSucceeded: (id: string, sequence: number) => void;
};
export declare const release: () => void, attentionStore: import("../lib/store").Store<AttentionState>, trackAttention: (sessions: ManagedSessionSummary[], selectedId: string | null) => void, clearAttention: (id: string) => void, useAttention: (id: string) => boolean, useAnyAttention: (ids: string[]) => boolean, clearAttentionAll: (ids: string[]) => void, acknowledgeSucceeded: (id: string, sequence: number) => void;
export {};
