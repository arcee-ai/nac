import type { BackendKind, LightModelSettings, UpdateConfigRequest } from "../types/api";
export declare function inheritPrimaryCredential(light: LightModelSettings, primaryBackend: BackendKind, primaryApiKeyEnv: string | null, previousApiKeyEnv?: string | null): LightModelSettings;
/**
 * Drop a light-model credential that came from inheriting the launch's
 * primary key. That selector is launch-specific (a typed key is stored under
 * a generated name), so remembering it would replay a name that may no longer
 * exist; a null credential re-inherits the next launch's primary.
 */
export declare function withoutInheritedCredential(light: LightModelSettings, primaryApiKeyEnv: string | null): LightModelSettings;
/** Field-by-field comparison, so serialization order can never fake a change. */
export declare function sameLightModel(left: LightModelSettings | null, right: LightModelSettings | null): boolean;
interface ManagedLaunchBaseUrlMap {
    [backend: string]: string;
}
export declare const MANAGED_LAUNCH_BASE_URLS: ManagedLaunchBaseUrlMap;
export type CredentialMode = "inherit" | "none" | "variable";
/** Reasoning effort sentinel meaning "clear the configured value". */
export declare const CLEAR_EFFORT = "__clear__";
export declare function managedLaunchBaseUrl(backend: string | null | undefined): string | null;
/** Backends that authenticate from stored credentials (no api_key_env allowed). */
export declare function backendUsesStoredCredentials(backend: string): boolean;
export declare function nullable(value: string | null | undefined): string | null;
export declare function csv(value: string | null | undefined): string[];
export declare function serializeExtraHeaders<T>(value: string, blankValue: T): Record<string, string> | T;
export interface LaunchLocation {
    cwd: string | null;
    ssh_host: string | null;
    ssh_port: number | null;
    ssh_identity_file: string | null;
}
/**
 * A remote session without an explicit path lands in the remote home.
 *
 * The port and the key are only sent along with a host, and only when filled in:
 * left blank, they stay with ssh to decide, which is what a host configured in
 * `~/.ssh/config` wants.
 */
export declare function launchLocationFromValues(values: {
    cwd: string;
    ssh_host: string;
    ssh_port?: string;
    ssh_identity_file?: string;
}): LaunchLocation;
export interface ModelFormValues {
    model: string;
    base_url: string;
    allow_insecure_http: boolean;
    backend: string;
    reasoning_effort: string;
    credential_mode: CredentialMode;
    api_key_env: string;
    extra_headers: string;
    orchestrator_compaction_threshold: string;
}
export interface SettingsInitialValues {
    model: string;
    base_url: string;
    allow_insecure_http: boolean;
    backend: string;
    reasoning_effort: string | null;
    api_key_env: string | null;
    extra_headers: Record<string, string>;
    orchestrator_compaction_threshold: number | null;
    /** Forces an extra-headers patch even when the parsed maps look equal. */
    extra_headers_invalid?: boolean;
}
/**
 * Minimal config patch from the settings form: required fields are validated,
 * unchanged fields are left out so a save never rewrites untouched values.
 */
export declare function buildSettingsPatch(values: ModelFormValues, initial: SettingsInitialValues, allowsCredentiallessSelection?: boolean): UpdateConfigRequest;
export {};
