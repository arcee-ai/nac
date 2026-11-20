import type { LaunchModelSelection } from "../setup/modelSelection";
import type { CreateSessionRequest } from "../../types/api";
import type { ServiceTier } from "../../lib/serviceTier";
/** A model picked for this session only. */
export interface ModelOverride {
    selection: LaunchModelSelection;
    source?: {
        projectId: string;
        sessionId: string;
        configVersion: number;
    };
}
export declare function modelChipLabel(override: ModelOverride | null): string | null;
/** Current session-only selection presented in the composer. */
export declare function sessionRoute(override: ModelOverride | null): {
    backend: "deepseek-chat" | "fireworks-chat" | "together-chat" | "openai-responses" | "openai-chat-completions" | "chatgpt-codex-responses" | "anthropic-messages" | "arcee-auth" | "arcee-api";
    model: string;
    baseUrl: string;
    effort: string;
    speed: ServiceTier | null | undefined;
} | null;
export declare function withEffort(override: ModelOverride | null, effort: string): ModelOverride | null;
export declare function withSpeed(override: ModelOverride | null, speed: ServiceTier | null): ModelOverride | null;
/** Compose a new session from the user's explicit model choice. */
export declare function configuredSessionRequest({ projectId, selected, }: {
    projectId: string;
    selected: LaunchModelSelection;
}): CreateSessionRequest;
