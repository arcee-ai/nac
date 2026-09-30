import type { LaunchModelSelection } from "@/app/components/modals/ConfigurationsPanel";
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
