import type {
  createPromptDraftStore,
  PromptDraft,
  PromptRecovery,
} from "../../store/promptDraftStore";

/** A text checkpoint around the existing command workflow, not an outbox or
 * retry. Oversized/unavailable recovery must not prevent the primary send;
 * its current draft remains intact until definite success acknowledges it. */
export async function withPromptRecovery<T>(
  drafts: ReturnType<typeof createPromptDraftStore>,
  sessionId: string,
  submitted: PromptDraft | undefined,
  dispatch: () => Promise<T>,
  /** An in-memory text entry exists; this is not a durable storage acknowledgement. */
  onRetained?: () => void,
): Promise<T> {
  let checkpoint: PromptRecovery | null = null;
  if (submitted) {
    try {
      checkpoint = drafts.retainSubmission(sessionId, submitted);
    } catch {
      /* Retain the current primary draft; storage failure does not gate sending. */
    }
  }
  try {
    if (checkpoint) onRetained?.();
    const result = await dispatch();
    if (checkpoint) drafts.settleSubmission(sessionId, checkpoint, "confirmed");
    return result;
  } catch (error) {
    // A response/error may follow admission. HTTP status and abort alone cannot
    // establish non-delivery. Existing transport readback remains authoritative.
    if (checkpoint) drafts.settleSubmission(sessionId, checkpoint, "uncertain");
    throw error;
  }
}
