import type { LaunchModelSelection } from "@/app/features/setup/modelSelection";
import type { CreateSessionRequest } from "@/app/types/api";
import type { ServiceTier } from "@/app/lib/serviceTier";

/** A model picked for this session only. */
export interface ModelOverride {
  selection: LaunchModelSelection;
  source?: { projectId: string; sessionId: string; configVersion: number };
}

export function modelChipLabel(override: ModelOverride | null): string | null {
  if (!override) return null;
  return [override.selection.model, override.selection.reasoning_effort]
    .filter(Boolean)
    .join(" · ");
}

/** Current session-only selection presented in the composer. */
export function sessionRoute(override: ModelOverride | null) {
  const selected = override?.selection;
  return selected
    ? {
        backend: selected.backend,
        model: selected.model,
        baseUrl: selected.base_url,
        effort: selected.reasoning_effort ?? "",
        speed: selected.service_tier,
      }
    : null;
}

export function withEffort(override: ModelOverride | null, effort: string): ModelOverride | null {
  return override
    ? {
        ...override,
        selection: { ...override.selection, reasoning_effort: effort || null },
      }
    : null;
}

export function withSpeed(
  override: ModelOverride | null,
  speed: ServiceTier | null,
): ModelOverride | null {
  return override
    ? { ...override, selection: { ...override.selection, service_tier: speed } }
    : null;
}

/** Compose a new session from the user's explicit model choice. */
export function configuredSessionRequest({
  projectId,
  selected,
}: {
  projectId: string;
  selected: LaunchModelSelection;
}): CreateSessionRequest {
  const request: CreateSessionRequest = {
    project_id: projectId,
    behavior: "direct",
    first_chat: false,
    first_chat_same_behavior: true,
    backend: selected.backend,
    model: selected.model,
    base_url: selected.base_url,
    allow_insecure_http: selected.allow_insecure_http,
    api_key_env: selected.api_key_env,
    reasoning_effort: selected.reasoning_effort,
    ...(selected.service_tier !== undefined ? { service_tier: selected.service_tier } : {}),
    extra_headers: selected.extra_headers,
  };
  if (selected.orchestrator_compaction_threshold !== undefined)
    request.orchestrator_compaction_threshold = selected.orchestrator_compaction_threshold;
  return request;
}
