import type { LaunchModelSelection } from "@/app/components/modals/ConfigurationsPanel";
import { sameLightModel } from "@/app/lib/modelConfig";
import type { BackendKind, ModelConfigurationRecord } from "@/app/types/api";

/** A persisted preset carries selectors, never credential values. */
export function savedModelSelection(
  record: ModelConfigurationRecord,
): Extract<LaunchModelSelection, { kind: "resolved" }> {
  return {
    kind: "resolved",
    backend: record.backend as BackendKind,
    model: record.model,
    base_url: record.base_url,
    allow_insecure_http: record.allow_insecure_http ?? false,
    api_key_env: record.api_key_env ?? null,
    reasoning_effort: record.reasoning_effort ?? null,
    extra_headers: record.extra_headers,
    orchestrator_compaction_threshold: record.orchestrator_compaction_threshold,
    light_model: record.light_model ?? null,
    config_id: record.config_id,
  };
}

function sameHeaders(
  left: Record<string, string> | null | undefined,
  right: Record<string, string> | null | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && left[key] === right[key])
  );
}

function sameOptionalLight(
  left: ModelConfigurationRecord["light_model"] | undefined,
  right: ModelConfigurationRecord["light_model"] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return sameLightModel(left ?? null, right ?? null);
}

/** Compare the complete value, never object insertion order. Undefined still means inheritance. */
export function sameModelSelection(
  left: LaunchModelSelection | null,
  right: LaunchModelSelection | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.kind === "resolved" && right.kind === "resolved") {
    return (
      left.backend === right.backend &&
      left.model === right.model &&
      left.base_url === right.base_url &&
      left.allow_insecure_http === right.allow_insecure_http &&
      left.api_key_env === right.api_key_env &&
      left.reasoning_effort === right.reasoning_effort &&
      sameHeaders(left.extra_headers, right.extra_headers) &&
      left.orchestrator_compaction_threshold === right.orchestrator_compaction_threshold &&
      sameOptionalLight(left.light_model, right.light_model) &&
      (left.config_id ?? null) === (right.config_id ?? null)
    );
  }
  if (left.kind !== "save" || right.kind !== "save") return false;
  const a = left.request,
    b = right.request;
  return (
    a.name === b.name &&
    a.backend === b.backend &&
    a.model === b.model &&
    a.base_url === b.base_url &&
    a.allow_insecure_http === b.allow_insecure_http &&
    a.api_key === b.api_key &&
    a.reasoning_effort === b.reasoning_effort &&
    a.initial_prompt === b.initial_prompt &&
    sameHeaders(a.extra_headers, b.extra_headers) &&
    a.orchestrator_compaction_threshold === b.orchestrator_compaction_threshold &&
    sameOptionalLight(a.light_model, b.light_model)
  );
}
