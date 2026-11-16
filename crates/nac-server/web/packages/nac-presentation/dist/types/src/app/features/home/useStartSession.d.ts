import type { SessionBehavior } from "../../types/api";
import { type ModelOverride } from "./modelChoice";
export interface StartRequest {
    projectId: string;
    behavior: SessionBehavior;
    prompt: string;
    /** Null: the server inherits the project's model, as for any plain create. */
    model: ModelOverride | null;
}
/**
 * Home's send: create the session (inheriting, or with the composer's model
 * override), deliver the prompt as its first message, then open it.
 *
 * Delivery never replays: a rejected first message is put back in the new
 * session's composer; an uncertain one is reported so the user checks before
 * resending.
 */
export declare function useStartSession(): {
    start: (request: StartRequest) => Promise<boolean>;
    busy: boolean;
    /** An uncertain configured create needs a fresh review (reload) before retrying. */
    needsReview: boolean;
    error: string | null;
    clearError: () => void;
};
