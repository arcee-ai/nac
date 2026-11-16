import type { NativeRuntimeScope } from "../runtime/nativeRuntime";
/** Caller-owned text storage, separate from long-lived preferences. */
export type PromptDraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> & {
    /** Cold desktop bytes have no durable proof that an earlier clear succeeded. */
    readonly coldImports?: true;
};
/** Explicit durable text identity, never a replacement for NativeRuntimeScope.
 * The desktop caller derives these opaque values from its verified profile/store.
 * It also owns adapter lifetime, document fencing and durable write ordering.
 * Other callers retain full-runtime/tab scoping unless they opt in explicitly.
 */
export interface PromptDraftPersistenceBinding {
    readonly owner: string;
    readonly profile: string;
    readonly organization: string;
    readonly host: string;
    readonly store: string;
    readonly track: string;
}
export interface PromptDraft {
    readonly text: string;
    readonly revision: number;
}
export interface PromptRecovery {
    readonly id: string;
    readonly text: string;
    readonly status: "pending" | "not-sent" | "uncertain";
    readonly source?: "checkpoint";
}
/** Text only. Request bridges, shell intents and attachment payloads never enter this owner. */
export declare function createPromptDraftStore(scope?: NativeRuntimeScope, storage?: PromptDraftStorage, persistenceBinding?: PromptDraftPersistenceBinding): {
    get: (sessionId: string) => PromptDraft;
    update: (sessionId: string, text: string) => PromptDraft;
    subscribe: (listener: () => void) => () => void;
    isRetentionLimited: () => boolean;
    useRetentionLimited: () => boolean;
    useDraft: (sessionId: string) => PromptDraft;
    getUnreviewed: (sessionId: string) => readonly PromptRecovery[];
    useUnreviewed: (sessionId: string) => readonly PromptRecovery[];
    hasSubmission: (sessionId: string, submitted: PromptDraft) => boolean;
    getUnretainedSubmission: (sessionId: string) => object | undefined;
    useUnretainedSubmission: (sessionId: string) => object | undefined;
    noteUnretainedSubmission: (sessionId: string, submitted: PromptDraft) => void;
    dismissUnretainedSubmission: (sessionId: string, token: object) => void;
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
    claimSubmission: (sessionId: string, submitted?: PromptDraft) => (() => void) | null;
    acknowledge: (sessionId: string, submitted: PromptDraft) => boolean;
    /** Use on confirmed deletion or loss of access, never against a partial session list. */
    purgeSessions: (sessionIds: readonly string[]) => void;
    /** Hosts call before closing on logout/revocation; ordinary release preserves reload recovery. */
    purgeAll: () => void;
    release: () => void;
};
export declare const get: (sessionId: string) => PromptDraft, update: (sessionId: string, text: string) => PromptDraft, subscribe: (listener: () => void) => () => void, useDraft: (sessionId: string) => PromptDraft, getUnreviewed: (sessionId: string) => readonly PromptRecovery[], useUnreviewed: (sessionId: string) => readonly PromptRecovery[], isRetentionLimited: () => boolean, useRetentionLimited: () => boolean, hasSubmission: (sessionId: string, submitted: PromptDraft) => boolean, getUnretainedSubmission: (sessionId: string) => object | undefined, useUnretainedSubmission: (sessionId: string) => object | undefined, noteUnretainedSubmission: (sessionId: string, submitted: PromptDraft) => void, dismissUnretainedSubmission: (sessionId: string, token: object) => void, getRecoveries: (sessionId: string) => readonly PromptRecovery[], useRecoveries: (sessionId: string) => readonly PromptRecovery[], retainSubmission: (sessionId: string, submitted: PromptDraft) => PromptRecovery | null, settleSubmission: (sessionId: string, recovery: PromptRecovery, status: "confirmed" | "not-sent" | "uncertain") => void, dismissRecovery: (sessionId: string, recovery: PromptRecovery) => void, restoreRecovery: (sessionId: string, recovery: PromptRecovery) => boolean, isSubmitting: (sessionId: string) => boolean, useCancelling: (sessionId: string) => boolean, claimCancellation: (sessionId: string) => (() => void) | null, useSubmitting: (sessionId: string) => boolean, claimSubmission: (sessionId: string, submitted?: PromptDraft) => (() => void) | null, acknowledge: (sessionId: string, submitted: PromptDraft) => boolean, purgeSessions: (sessionIds: readonly string[]) => void, purgeAll: () => void, release: () => void;
