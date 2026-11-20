import type { ServiceTier } from "../../lib/serviceTier";
import type { BackendKind } from "../../types/api";
/** The model and route chosen for one session. Credential values stay server-side. */
export interface LaunchModelSelection {
    kind: "resolved";
    backend: BackendKind;
    model: string;
    base_url: string;
    allow_insecure_http: boolean;
    api_key_env: string | null;
    reasoning_effort: string | null;
    service_tier?: ServiceTier | null;
    extra_headers: Record<string, string> | null;
    compaction_threshold?: number | null;
}
export interface SessionModelInitial {
    backend: BackendKind;
    model: string;
    base_url: string;
    allow_insecure_http?: boolean;
    api_key_env: string | null;
    reasoning_effort: string | null;
    service_tier?: ServiceTier | null;
    extra_headers: Record<string, string>;
    compaction_threshold?: number | null;
}
export declare function sameModelSelection(left: LaunchModelSelection | null, right: LaunchModelSelection | null): boolean;
