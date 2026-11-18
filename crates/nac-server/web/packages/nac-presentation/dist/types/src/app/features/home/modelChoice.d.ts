import type { ServiceTier } from "../../lib/serviceTier";
import type { ConfigurationsPanelInitial, LaunchModelSelection } from "../../components/modals/ConfigurationsPanel";
import type { LightSelection } from "../../components/modals/LightModelSection";
import type { UiPolicy } from "../ui-policy/policy";
import type { BackendKind, CreateSessionRequest, LightModelSettings, SessionBehavior } from "../../types/api";
/** What a new session in a project inherits when the user changes nothing. */
export interface InheritedModel {
    initial: ConfigurationsPanelInitial;
    light: LightModelSettings | null;
    source: "project-default" | "latest-session";
}
/** A model the user picked in the composer's model chip for this session only. */
export interface ModelOverride {
    selection: LaunchModelSelection;
    light: LightSelection;
    /** The light model the primary selection carries (a saved setup owns one). */
    selectedLight: LightModelSettings | null | undefined;
}
/**
 * The model a new session in `projectId` inherits: the project's saved default,
 * else the newest-created sibling's settings (the server's own inheritance
 * order for a request that names no model).
 */
export declare function useInheritedModel(projectId: string | null): {
    inherited: InheritedModel | null;
    pending: boolean;
    error: Error | null;
};
/** A short chip label: "model · effort". */
export declare function modelChipLabel(override: ModelOverride | null, inherited: InheritedModel | null): string | null;
/** The resolved tuple a configured session is created with. */
export interface ResolvedModel {
    backend: BackendKind;
    model: string;
    base_url: string;
    allow_insecure_http: boolean;
    api_key_env: string | null;
    reasoning_effort: string | null;
    service_tier?: ServiceTier | null;
    extra_headers: Record<string, string> | null;
    orchestrator_compaction_threshold?: number | null;
}
/** The light model sent with an override (explicit null = single-model session). */
export declare function overrideLight(policy: UiPolicy, override: ModelOverride, selected: ResolvedModel): LightModelSettings | null;
/** Same request NewChat built for an explicit per-session model choice. */
export declare function configuredSessionRequest({ policy, projectId, behavior, selected, light, }: {
    policy: UiPolicy;
    projectId: string;
    behavior: SessionBehavior;
    selected: ResolvedModel;
    light: LightModelSettings | null;
}): CreateSessionRequest;
