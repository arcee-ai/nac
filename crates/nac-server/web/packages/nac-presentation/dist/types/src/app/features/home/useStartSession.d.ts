import { type ModelOverride } from "./modelChoice";
export interface StartRequest {
    projectId: string;
    prompt: string;
    model: ModelOverride;
}
/**
 * Create a session with the chosen model, deliver the prompt, and open it.
 *
 * The runtime-only first-message intent is consumed by the owning composer
 * after its interactive stream is live. Reload/replacement retains text only,
 * never an executable intent.
 */
export declare function useStartSession(): {
    start: (request: StartRequest) => Promise<boolean>;
    busy: boolean;
    /** An uncertain configured create needs a fresh review (reload) before retrying. */
    needsReview: boolean;
    error: string | null;
    clearError: () => void;
};
