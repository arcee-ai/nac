import type { NativeRuntimeScope } from "../runtime/nativeRuntime";
/** A caller-owned, tab-scoped adapter, separate from long-lived preferences. */
export type PromptDraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface PromptDraft {
    readonly text: string;
    readonly revision: number;
}
export interface PromptRecovery {
    readonly id: string;
    readonly text: string;
    readonly status: "pending" | "not-sent" | "uncertain";
}
/** Text only. Request bridges, shell intents and attachment payloads never enter this owner. */
export declare function createPromptDraftStore(scope?: NativeRuntimeScope, storage?: PromptDraftStorage): {
    get: (sessionId: string) => PromptDraft;
    update: (sessionId: string, text: string) => PromptDraft;
    subscribe: (listener: () => void) => () => void;
    useDraft: (sessionId: string) => PromptDraft;
    getRecoveries: (sessionId: string) => readonly PromptRecovery[];
    useRecoveries: (sessionId: string) => readonly PromptRecovery[];
    retainSubmission: (sessionId: string, submitted: PromptDraft) => PromptRecovery | null;
    settleSubmission: (sessionId: string, recovery: PromptRecovery, status: "confirmed" | "not-sent" | "uncertain") => void;
    dismissRecovery: (sessionId: string, recovery: PromptRecovery) => void;
    restoreRecovery: (sessionId: string, recovery: PromptRecovery) => boolean;
    isSubmitting: (sessionId: string) => boolean;
    useCancelling: (sessionId: string) => boolean;
    claimCancellation: (sessionId: string) => (() => void) | null;
    useSubmitting: (sessionId: string) => boolean;
    /** One pending primary-composer operation per session, independent of its current view. */
    claimSubmission: (sessionId: string) => (() => void) | null;
    acknowledge: (sessionId: string, submitted: PromptDraft) => boolean;
    /** Use on confirmed deletion or loss of access, never against a partial session list. */
    purgeSessions: (sessionIds: readonly string[]) => void;
    /** Hosts call before closing on logout/revocation; ordinary release preserves reload recovery. */
    purgeAll: () => void;
    release: () => void;
};
export declare const get: (sessionId: string) => PromptDraft, update: (sessionId: string, text: string) => PromptDraft, subscribe: (listener: () => void) => () => void, useDraft: (sessionId: string) => PromptDraft, getRecoveries: (sessionId: string) => readonly PromptRecovery[], useRecoveries: (sessionId: string) => readonly PromptRecovery[], retainSubmission: (sessionId: string, submitted: PromptDraft) => PromptRecovery | null, settleSubmission: (sessionId: string, recovery: PromptRecovery, status: "confirmed" | "not-sent" | "uncertain") => void, dismissRecovery: (sessionId: string, recovery: PromptRecovery) => void, restoreRecovery: (sessionId: string, recovery: PromptRecovery) => boolean, isSubmitting: (sessionId: string) => boolean, useCancelling: (sessionId: string) => boolean, claimCancellation: (sessionId: string) => (() => void) | null, useSubmitting: (sessionId: string) => boolean, claimSubmission: (sessionId: string) => (() => void) | null, acknowledge: (sessionId: string, submitted: PromptDraft) => boolean, purgeSessions: (sessionIds: readonly string[]) => void, purgeAll: () => void, release: () => void;
