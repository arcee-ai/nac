import type { LaunchModelSelection } from "@/app/features/setup/modelSelection";
import type { CreateSessionRequest } from "@/app/types/api";

/** A model picked for this session only. */
export interface ModelOverride {
  selection: LaunchModelSelection;
}

export function modelChipLabel(override: ModelOverride | null): string | null {
  if (!override) return null;
  return [override.selection.model, override.selection.reasoning_effort]
    .filter(Boolean)
    .join(" · ");
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
    extra_headers: selected.extra_headers,
  };
  if (selected.compaction_threshold !== undefined)
    request.compaction_threshold = selected.compaction_threshold;
  return request;
}
