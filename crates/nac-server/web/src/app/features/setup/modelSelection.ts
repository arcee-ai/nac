import type { BackendKind } from "@/app/types/api";

/** The model and route chosen for one session. Credential values stay server-side. */
export interface LaunchModelSelection {
  kind: "resolved";
  backend: BackendKind;
  model: string;
  base_url: string;
  allow_insecure_http: boolean;
  api_key_env: string | null;
  reasoning_effort: string | null;
  extra_headers: Record<string, string> | null;
  orchestrator_compaction_threshold?: number | null;
}

export interface SessionModelInitial {
  backend: BackendKind;
  model: string;
  base_url: string;
  allow_insecure_http?: boolean;
  api_key_env: string | null;
  reasoning_effort: string | null;
  extra_headers: Record<string, string>;
  orchestrator_compaction_threshold?: number | null;
}

export function sameModelSelection(
  left: LaunchModelSelection | null,
  right: LaunchModelSelection | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const headersEqual =
    left.extra_headers === right.extra_headers ||
    (left.extra_headers != null &&
      right.extra_headers != null &&
      Object.keys(left.extra_headers).length === Object.keys(right.extra_headers).length &&
      Object.entries(left.extra_headers).every(
        ([key, value]) => right.extra_headers?.[key] === value,
      ));
  return (
    left.backend === right.backend &&
    left.model === right.model &&
    left.base_url === right.base_url &&
    left.allow_insecure_http === right.allow_insecure_http &&
    left.api_key_env === right.api_key_env &&
    left.reasoning_effort === right.reasoning_effort &&
    headersEqual &&
    left.orchestrator_compaction_threshold === right.orchestrator_compaction_threshold
  );
}
