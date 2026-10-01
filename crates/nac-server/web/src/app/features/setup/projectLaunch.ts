import type { LaunchModelSelection } from "@/app/components/modals/ConfigurationsPanel";
import type { LightSelection } from "@/app/components/modals/LightModelSection";
import { creationBehavior, type UiPolicy } from "@/app/features/ui-policy/policy";
import { CLEAR_EFFORT, csv, inheritPrimaryCredential, nullable } from "@/app/lib/modelConfig";
import type { CreateSessionRequest, LightModelSettings, SessionBehavior } from "@/app/types/api";

export interface SandboxOptions {
  noMount: boolean;
  image: string;
  gpu: string;
  workdir: string;
  shm: string;
  mounts: string;
}

/** Compose explicit overrides once; a project's location is never restated on its chat. */
export function projectChatRequest(values: {
  projectId: string;
  selected: Extract<LaunchModelSelection, { kind: "resolved" }>;
  policy: UiPolicy;
  behavior: SessionBehavior;
  reasoning: string;
  headers: Record<string, string> | undefined;
  compaction: string;
  presetCompaction: boolean;
  savedLight: LightModelSettings | null | undefined;
  light: LightSelection;
  execution: "local" | "ssh" | "sandbox";
  sandbox: SandboxOptions;
  activityKey: string | null;
}): CreateSessionRequest {
  const { selected, policy, light, sandbox } = values;
  const body: CreateSessionRequest = {
    project_id: values.projectId,
    behavior: creationBehavior(policy, values.behavior),
    first_chat: true,
    first_chat_same_behavior: !policy.orchestrationEnabled,
    backend: selected.backend,
    model: selected.model,
    base_url: selected.base_url,
    allow_insecure_http: selected.allow_insecure_http,
    api_key_env: selected.api_key_env,
    reasoning_effort:
      values.reasoning === CLEAR_EFFORT
        ? null
        : values.reasoning || selected.reasoning_effort || null,
    // Explicit Single overrides a saved Dual default; direct preserves hidden stored data.
    light_model: !policy.orchestrationEnabled
      ? (values.savedLight ?? null)
      : light.mode === "dual" && light.light
        ? inheritPrimaryCredential(light.light, selected.backend, selected.api_key_env)
        : null,
  };
  const headers = values.headers ?? selected.extra_headers ?? undefined;
  if (headers !== undefined) body.extra_headers = headers;
  if (values.presetCompaction && selected.orchestrator_compaction_threshold !== undefined)
    body.orchestrator_compaction_threshold = selected.orchestrator_compaction_threshold;
  else if (nullable(values.compaction) !== null)
    body.orchestrator_compaction_threshold = Number(values.compaction);
  if (values.execution !== "ssh")
    body.sandbox = {
      enabled: values.execution === "sandbox",
      no_mount_cwd: sandbox.noMount,
      image: nullable(sandbox.image),
      gpus: csv(sandbox.gpu),
      workdir: nullable(sandbox.workdir),
      shm_size: nullable(sandbox.shm),
      mounts: csv(sandbox.mounts),
      mounts_ro: [],
      activity_key: values.activityKey,
    };
  return body;
}
