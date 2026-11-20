import type { SessionBehavior } from "../../types/api";
import { type ModelOverride } from "./modelChoice";
import { type SandboxOptions } from "./workspaceSandbox";
export interface StartRequest {
    projectId: string;
    behavior: SessionBehavior;
    prompt: string;
    /** Null: the server inherits the project's model, as for any plain create. */
    model: ModelOverride | null;
    sandbox?: SandboxOptions;
}
/**
 * Home's send: create the session (inheriting, or with the composer's model
 * override), deliver the prompt as its first message, then open it.
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
    sandboxProgress: string | null;
    clearError: () => void;
};
