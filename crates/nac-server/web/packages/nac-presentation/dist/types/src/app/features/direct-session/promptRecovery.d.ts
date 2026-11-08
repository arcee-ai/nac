import type { createPromptDraftStore, PromptDraft } from "../../store/promptDraftStore";
/** A text checkpoint around the existing command workflow, not an outbox or
 * retry. Oversized/unavailable recovery must not prevent the primary send;
 * its current draft remains intact until definite success acknowledges it. */
export declare function withPromptRecovery<T>(drafts: ReturnType<typeof createPromptDraftStore>, sessionId: string, submitted: PromptDraft | undefined, dispatch: () => Promise<T>,
/** An in-memory text entry exists; this is not a durable storage acknowledgement. */
onRetained?: () => void): Promise<T>;
