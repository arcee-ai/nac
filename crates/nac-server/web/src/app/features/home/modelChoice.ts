import { useQuery } from "@tanstack/react-query";
import type { ServiceTier } from "@/app/lib/serviceTier";
import { useMemo } from "react";

import type {
  ConfigurationsPanelInitial,
  LaunchModelSelection,
} from "@/app/components/modals/ConfigurationsPanel";
import type { LightSelection } from "@/app/components/modals/LightModelSection";
import type { UiPolicy } from "@/app/features/ui-policy/policy";
import { creationBehavior } from "@/app/features/ui-policy/policy";
import { inheritPrimaryCredential } from "@/app/lib/modelConfig";
import { newestCreatedPrimarySessionForProject } from "@/app/lib/projects";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import {
  useModelConfigs,
  useProjects,
  useSessionConfig,
  useSessions,
} from "@/app/services/queries";
import type {
  BackendKind,
  CreateSessionRequest,
  LightModelSettings,
  ModelConfigurationRecord,
  ProjectRecord,
  RawSessionConfig,
  SessionBehavior,
} from "@/app/types/api";

/** What a new session in a project inherits when the user changes nothing. */
export interface InheritedModel {
  initial: ConfigurationsPanelInitial;
  light: LightModelSettings | null;
  source: "project-default" | "latest-session";
}

/** The serving runtime resolves file defaults in the actual launch location. */
export function useConfiguredLaunchModel(project: ProjectRecord | null, enabled: boolean) {
  const { api } = useNativeRuntime();
  const target = project && {
    cwd: project.cwd,
    ssh_host: project.ssh_host,
    ssh_port: project.ssh_port,
    ssh_identity_file: project.ssh_identity_file,
  };
  const query = useQuery({
    queryKey: ["launch-model-defaults", target],
    queryFn: ({ signal }) => api.launchDefaults(target ?? {}, signal),
    enabled: enabled && target != null,
    retry: false,
  });
  return {
    model: enabled ? (query.data?.configured_model ?? null) : null,
    pending: enabled && query.isPending,
    error: enabled ? query.error : null,
  };
}

/** A model the user picked in the composer's model chip for this session only. */
export interface ModelOverride {
  selection: LaunchModelSelection;
  light: LightSelection;
  /** The light model the primary selection carries (a saved setup owns one). */
  selectedLight: LightModelSettings | null | undefined;
}

function parseHeaders(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (Object(parsed) !== parsed || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function fromSavedConfiguration(record: ModelConfigurationRecord): InheritedModel {
  return {
    initial: {
      // SAFETY: model configurations are created through the backend's typed
      // BackendKind request even though the stored compatibility record is a string.
      backend: record.backend as BackendKind,
      model: record.model,
      base_url: record.base_url,
      allow_insecure_http: record.allow_insecure_http,
      api_key_env: record.api_key_env ?? null,
      reasoning_effort: record.reasoning_effort ?? null,
      ...(record.service_tier != null ? { service_tier: record.service_tier as ServiceTier } : {}),
      extra_headers: record.extra_headers,
      orchestrator_compaction_threshold: record.orchestrator_compaction_threshold,
      light_model: record.light_model ?? null,
      config_id: record.config_id,
    },
    light: record.light_model ?? null,
    source: "project-default",
  };
}

function fromSessionConfiguration(
  config: RawSessionConfig,
  summaryBackend: string,
): InheritedModel {
  return {
    initial: {
      // SAFETY: both values originate from the server's validated BackendKind
      // persistence path; the raw compatibility projection permits null/string.
      backend: (config.backend ?? summaryBackend) as BackendKind,
      model: config.model,
      base_url: config.base_url,
      allow_insecure_http: config.allow_insecure_http,
      api_key_env: config.api_key_env ?? null,
      reasoning_effort: config.reasoning_effort ?? null,
      ...(config.service_tier != null ? { service_tier: config.service_tier as ServiceTier } : {}),
      extra_headers: parseHeaders(config.extra_headers_json),
      orchestrator_compaction_threshold: config.orchestrator_compaction_threshold,
      light_model: config.light_model ?? null,
    },
    light: config.light_model ?? null,
    source: "latest-session",
  };
}

/**
 * The model a new session in `projectId` inherits: the project's saved default,
 * else the newest-created sibling's settings (the server's own inheritance
 * order for a request that names no model).
 */
export function useInheritedModel(projectId: string | null) {
  const projects = useProjects();
  const sessions = useSessions();
  const modelConfigs = useModelConfigs();
  const project = projects.data?.projects.find((entry) => entry.project_id === projectId) ?? null;
  const sibling = projectId
    ? newestCreatedPrimarySessionForProject(sessions.data ?? [], projectId)
    : null;
  const defaultId = project?.default_model_config_id ?? null;
  const defaultConfig = defaultId
    ? (modelConfigs.data?.configurations.find((record) => record.config_id === defaultId) ?? null)
    : null;
  const siblingConfig = useSessionConfig(defaultId ? null : (sibling?.summary.session_id ?? null));
  const inherited = useMemo<InheritedModel | null>(() => {
    if (defaultConfig) return fromSavedConfiguration(defaultConfig);
    if (siblingConfig.data && sibling) {
      return fromSessionConfiguration(siblingConfig.data, sibling.summary.backend);
    }
    return null;
  }, [defaultConfig, siblingConfig.data, sibling]);
  const pending =
    projectId != null &&
    (projects.isPending ||
      sessions.isPending ||
      modelConfigs.isPending ||
      (Boolean(sibling) && !defaultId && siblingConfig.isPending));
  const error =
    projects.error ||
    sessions.error ||
    siblingConfig.error ||
    (defaultId && (modelConfigs.error || (!modelConfigs.isPending && !defaultConfig))
      ? new Error("The project default model is unavailable. Review the project settings.")
      : null);
  return { inherited, pending, error: error || null };
}

/** A model id without its vendor prefix: "deepseek/deepseek-v4" reads "deepseek-v4". */
function shortModel(model: string): string {
  return model.split("/").pop() || model;
}

/** The model chip's label; reasoning effort has its own chip. */
export function modelChipLabel(
  override: ModelOverride | null,
  inherited: InheritedModel | null,
): string | null {
  if (override) {
    const selection = override.selection;
    if (selection.kind === "save") return selection.request.model || selection.request.name;
    return shortModel(selection.model);
  }
  return inherited ? shortModel(inherited.initial.model) : null;
}

/** The route and preferences a session will start with. */
export function sessionRoute(
  override: ModelOverride | null,
  inherited: InheritedModel | null,
): {
  backend: BackendKind;
  model: string;
  baseUrl: string;
  effort: string;
  speed: ServiceTier | null | undefined;
} | null {
  const selection = override?.selection;
  if (selection?.kind === "resolved") {
    return {
      backend: selection.backend,
      model: selection.model,
      baseUrl: selection.base_url,
      effort: selection.reasoning_effort ?? "",
      speed: selection.service_tier,
    };
  }
  if (selection || !inherited) return null;
  return {
    backend: inherited.initial.backend,
    model: inherited.initial.model,
    baseUrl: inherited.initial.base_url,
    effort: inherited.initial.reasoning_effort ?? "",
    speed: inherited.initial.service_tier,
  };
}

/** The inherited model as an explicit override, so one setting can change for this session. */
function inheritedOverride(inherited: InheritedModel): ModelOverride {
  const initial = inherited.initial;
  return {
    selection: {
      kind: "resolved",
      backend: initial.backend,
      model: initial.model,
      base_url: initial.base_url,
      allow_insecure_http: initial.allow_insecure_http ?? false,
      api_key_env: initial.api_key_env,
      reasoning_effort: initial.reasoning_effort,
      service_tier: initial.service_tier,
      extra_headers: initial.extra_headers,
      orchestrator_compaction_threshold: initial.orchestrator_compaction_threshold,
      light_model: inherited.light,
      config_id: initial.config_id,
    },
    light: inherited.light
      ? { mode: "dual", light: inherited.light }
      : { mode: "single", light: null },
    selectedLight: inherited.light,
  };
}

/** `override` (or the inherited model) with a different reasoning effort; "" is the model's default. */
export function withEffort(
  override: ModelOverride | null,
  inherited: InheritedModel | null,
  effort: string,
): ModelOverride | null {
  const base = override ?? (inherited ? inheritedOverride(inherited) : null);
  if (base?.selection.kind !== "resolved") return base;
  return { ...base, selection: { ...base.selection, reasoning_effort: effort || null } };
}

export function withSpeed(
  override: ModelOverride | null,
  inherited: InheritedModel | null,
  speed: ServiceTier | null,
): ModelOverride | null {
  const base = override ?? (inherited ? inheritedOverride(inherited) : null);
  if (base?.selection.kind !== "resolved") return base;
  return { ...base, selection: { ...base.selection, service_tier: speed } };
}

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
export function overrideLight(
  policy: UiPolicy,
  override: ModelOverride,
  selected: ResolvedModel,
): LightModelSettings | null {
  if (!policy.orchestrationEnabled) return override.selectedLight ?? null;
  return override.light.mode === "dual" && override.light.light
    ? inheritPrimaryCredential(override.light.light, selected.backend, selected.api_key_env)
    : null;
}

/** Same request NewChat built for an explicit per-session model choice. */
export function configuredSessionRequest({
  policy,
  projectId,
  behavior,
  selected,
  light,
}: {
  policy: UiPolicy;
  projectId: string;
  behavior: SessionBehavior;
  selected: ResolvedModel;
  light: LightModelSettings | null;
}): CreateSessionRequest {
  const request: CreateSessionRequest = {
    project_id: projectId,
    behavior: creationBehavior(policy, behavior),
    first_chat: false,
    first_chat_same_behavior: !policy.orchestrationEnabled,
    backend: selected.backend,
    model: selected.model,
    base_url: selected.base_url,
    allow_insecure_http: selected.allow_insecure_http,
    api_key_env: selected.api_key_env,
    reasoning_effort: selected.reasoning_effort,
    ...(selected.service_tier !== undefined ? { service_tier: selected.service_tier } : {}),
    extra_headers: selected.extra_headers,
    // Explicit null matters: it lets a user turn an inherited dual-model
    // project default into a single-model session without changing the project.
    light_model: light,
  };
  if (selected.orchestrator_compaction_threshold !== undefined) {
    request.orchestrator_compaction_threshold = selected.orchestrator_compaction_threshold;
  }
  return request;
}
