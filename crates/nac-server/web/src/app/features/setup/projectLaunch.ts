import type { LaunchModelSelection } from "@/app/features/setup/modelSelection";
import { CLEAR_EFFORT, csv, nullable } from "@/app/lib/modelConfig";
import type { CreateSessionRequest } from "@/app/types/api";

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
  reasoning: string;
  headers: Record<string, string> | undefined;
  compaction: string;
  automaticCompaction: boolean;
  execution: "local" | "ssh" | "sandbox";
  sandbox: SandboxOptions;
  activityKey: string | null;
}): CreateSessionRequest {
  const { selected, sandbox } = values;
  const body: CreateSessionRequest = {
    project_id: values.projectId,
    behavior: "direct",
    first_chat: true,
    first_chat_same_behavior: true,
    backend: selected.backend,
    model: selected.model,
    base_url: selected.base_url,
    allow_insecure_http: selected.allow_insecure_http,
    api_key_env: selected.api_key_env,
    reasoning_effort:
      values.reasoning === CLEAR_EFFORT
        ? null
        : values.reasoning || selected.reasoning_effort || null,
  };
  const headers = values.headers ?? selected.extra_headers ?? undefined;
  if (headers !== undefined) body.extra_headers = headers;
  if (
    !(selected.backend === "chatgpt-codex-responses" && values.automaticCompaction) &&
    nullable(values.compaction) !== null
  )
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
