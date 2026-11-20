export type DelegatedCompletionKind = "coding-agent";
export type DelegatedCompletionStatus = "completed" | "failed" | "cancelled" | "interrupted";
export interface DelegatedCompletion {
    kind: DelegatedCompletionKind;
    sessionId: string;
    generation: number;
    status: DelegatedCompletionStatus;
    description: string;
    outcome: string | null;
    changes: string | null;
    verification: string | null;
}
/** Strictly recognizes a backend-owned child completion envelope. */
export declare function parseDelegatedCompletion(content: string | null | undefined): DelegatedCompletion | null;
