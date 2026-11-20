import { useQuery } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type {
  BackendKind,
  ManagedSessionSummary,
  ProjectRecord,
  ProjectSessionModelSource,
} from "@/app/types/api";
import type { ServiceTier } from "@/app/lib/serviceTier";
import type { ModelOverride } from "./modelChoice";
import type { NativeApi } from "@/app/services/api";
import { SetupValidation } from "@/app/features/setup/browserAdapters";
import { isBackendKind } from "@/app/lib/providers";

/** Only an ordinary top-level session in the same project and workspace can supply a visible starting selection. */
export function eligibleSource(entry: ManagedSessionSummary, project: ProjectRecord): boolean {
  const session = entry.summary;
  return (
    entry.lineage == null &&
    session.project_id === project.project_id &&
    !session.sandboxed &&
    !session.model_config_error &&
    session.cwd === project.cwd &&
    (session.ssh_host ?? null) === (project.ssh_host ?? null) &&
    (session.ssh_port ?? null) === (project.ssh_port ?? null) &&
    (session.ssh_identity_file ?? null) === (project.ssh_identity_file ?? null)
  );
}

export function sourceSelection(
  config: ProjectSessionModelSource,
  source: ManagedSessionSummary,
): ModelOverride | null {
  if (
    config.session_id !== source.summary.session_id ||
    !config.model ||
    !config.base_url ||
    config.diagnostics?.length
  )
    return null;
  const backend = config.backend;
  if (
    !backend ||
    !isBackendKind(backend) ||
    (config.service_tier != null &&
      !["standard", "fast", "ultrafast"].includes(config.service_tier))
  )
    return null;
  if (!source.summary.project_id) return null;
  return {
    source: {
      projectId: source.summary.project_id,
      sessionId: config.session_id,
      configVersion: config.config_version,
    },
    selection: {
      kind: "resolved",
      backend: backend as BackendKind,
      model: config.model,
      base_url: config.base_url,
      allow_insecure_http: config.allow_insecure_http,
      api_key_env: config.api_key_env ?? null,
      reasoning_effort: config.reasoning_effort ?? null,
      service_tier: config.service_tier as ServiceTier | null | undefined,
      extra_headers: null,
    },
  };
}

export function useSourceSessionModel(
  project: ProjectRecord | null,
  sessions: readonly ManagedSessionSummary[],
  preferred: string | null,
) {
  const candidates = project ? sessions.filter((entry) => eligibleSource(entry, project)) : [];
  const source = preferred
    ? (candidates.find((entry) => entry.summary.session_id === preferred) ?? null)
    : ([...candidates].sort((a, b) =>
        b.summary.created_at.localeCompare(a.summary.created_at),
      )[0] ?? null);
  const { api } = useNativeRuntime();
  const sourceId = source?.summary.session_id ?? null;
  const projectId = project?.project_id ?? null;
  const config = useQuery({
    queryKey: ["project-session-model-source", projectId, sourceId],
    queryFn: ({ signal }) => api.getProjectSessionModelSource(projectId!, sourceId!, signal),
    enabled: projectId != null && sourceId != null,
    retry: false,
    staleTime: 0,
  });
  return {
    model:
      source && config.isSuccess && !config.isFetching && config.data
        ? sourceSelection(config.data, source)
        : null,
    pending: source != null && (config.isPending || config.isFetching),
    hasSource: source != null || preferred != null,
    error: source != null && config.isError,
  };
}

/** Recheck a sourced choice immediately before a new write; no mutation occurs on failure. */
export async function requireCurrentSource(
  api: Pick<NativeApi, "getProjectSessionModelSource">,
  projectId: string,
  model: ModelOverride,
  signal: AbortSignal,
): Promise<void> {
  if (!model.source) return;
  try {
    if (model.source.projectId !== projectId) throw new Error("project changed");
    const fresh = await api.getProjectSessionModelSource(
      projectId,
      model.source.sessionId,
      AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    );
    if (fresh.config_version !== model.source.configVersion)
      throw new Error("configuration changed");
  } catch {
    throw new SetupValidation(
      "The source session changed or moved. Review the model selection before starting.",
    );
  }
}
