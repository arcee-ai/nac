// TanStack Query bindings for the nac API. Server state lives here; only
// client state (selection, filters, live run status) goes into the stores.

import { useCallback, useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  type InfiniteData,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import {
  pinGroup,
  placeSessionId,
  reorderRequest,
  sameOrder,
  withUpdatedSummary,
} from "@/app/lib/sessionOrder";
import {
  SNAPSHOT_MESSAGE_LIMIT,
  SNAPSHOT_THREAD_EVENT_LIMIT,
  mergeFocusedSnapshot,
  validSnapshotWindow,
  prependMessagePage,
  validMessagesPage,
} from "@/app/lib/messageWindow";
import { api } from "@/app/services/api";
import {
  beginSnapshotFetch,
  finishSnapshotFetch,
  currentSessionGeneration,
  fenceSessionSnapshot,
  isCurrentSessionGeneration,
} from "@/app/services/sessionRefresh";
import { setOptimisticUserPrompt } from "@/app/store/runtimeStore";
import type {
  BackendKind,
  BranchList,
  BrowseListing,
  CommitWorkspaceRequest,
  CreateModelConfigurationRequest,
  CreateSessionRequest,
  ManagedSessionSummary,
  ModelCatalog,
  ModelConfigurationList,
  ProviderModel,
  ProviderModelList,
  RawSessionConfig,
  ManagedAuthList,
  ManagedAuthProvider,
  ResolvedModelConfiguration,
  SessionSnapshotResponse,
  SlashCommandDefinition,
  SessionSummarySnapshot,
  ThreadEventPage,
  SshConfigurationList,
  CreateSshConfigurationRequest,
  UpdateSshConfigurationRequest,
  McpLibraryResponse,
  McpServerList,
  CreateMcpServerRequest,
  UpdateMcpServerRequest,
  TestMcpServerRequest,
  SshTarget,
  StoredCredentialList,
  StoreInfo,
  SandboxActivity,
  SandboxAvailability,
  SwitchBranchRequest,
  UpdateConfigRequest,
  UpdateModelConfigurationRequest,
  WorkspaceDiffStage,
  WorkspaceFileContent,
  WorkspaceFileDiff,
  WorkspaceFileList,
  WorkspaceRevision,
  WorkspaceRevisionChanges,
} from "@/app/types/api";

/** How often the session list is refreshed; the list has no event stream. */
export const SESSIONS_POLL_MS = 5000;
export const WORKSPACE_STATS_POLL_MS = 30_000;


export const queryKeys = {
  storeInfo: ["store"] as const,
  sandboxAvailability: ["sandbox-availability"] as const,
  sandboxActivity: ["sandbox-activity"] as const,
  credentials: ["credentials"] as const,
  managedAuth: ["managed-auth"] as const,
  modelConfigs: ["model-configs"] as const,
  sshConfigs: ["ssh-configs"] as const,
  mcpLibrary: ["mcp-library"] as const,
  mcpServers: ["mcp-servers"] as const,
  browse: (path: string, kind: BrowseKind, hidden: boolean) =>
    ["fs-browse", { path, kind, hidden }] as const,
  sshBrowse: (target: SshTarget, path: string, hidden = false) =>
    [
      "ssh-browse",
      {
        host: target.ssh_host,
        port: target.ssh_port ?? null,
        identityFile: target.ssh_identity_file ?? null,
        path,
        hidden,
      },
    ] as const,
  providerModels: (backend: string, apiKey: string, baseUrl: string) =>
    ["provider-models", { backend, apiKey, baseUrl }] as const,
  storedKeyProviderModels: (backend: string, apiKeyEnv: string, baseUrl: string) =>
    ["stored-key-provider-models", { backend, apiKeyEnv, baseUrl }] as const,
  managedProviderModels: (backend: string) =>
    ["managed-provider-models", backend] as const,
  managedProviderModelsAll: ["managed-provider-models"] as const,
  modelCatalog: ["model-catalog"] as const,
  slashCommands: ["slash-commands"] as const,
  resolvedModelConfig: (configId: string) =>
    ["model-config-resolved", configId] as const,
  resolvedModelConfigsAll: ["model-config-resolved"] as const,
  resolvedConfigFile: (path: string) => ["config-file-resolved", path] as const,
  resolvedConfigFilesAll: ["config-file-resolved"] as const,
  sessions: (workspaceStats: boolean) => ["sessions", { workspaceStats }] as const,
  sessionRoot: (id: string) => ["session", id] as const,
  sessionSnapshot: (id: string) => ["session", id, "snapshot"] as const,
  sessionsAll: ["sessions"] as const,
  threadEventsRoot: (id: string) =>
    ["session", id, "thread-events"] as const,
  threadEvents: (id: string, threadName: string) =>
    ["session", id, "thread-events", threadName] as const,
  sessionConfig: (id: string) => ["session", id, "config"] as const,
  workspaceDiff: (
    id: string,
    path: string,
    stage: WorkspaceDiffStage | "all",
    context: number,
    revision: number | null,
  ) =>
    ["session", id, "workspace-diff", { path, stage, context, revision }] as const,
  workspaceDiffRoot: (id: string) => ["session", id, "workspace-diff"] as const,
  branches: (id: string) => ["session", id, "branches"] as const,
  workspaceFiles: (id: string, revision: number | null) =>
    ["session", id, "workspace-files", { revision }] as const,
  workspaceFilesRoot: (id: string) =>
    ["session", id, "workspace-files"] as const,
  workspaceFile: (id: string, path: string, revision: number | null) =>
    ["session", id, "workspace-file", { path, revision }] as const,
  workspaceFileRoot: (id: string) => ["session", id, "workspace-file"] as const,
  workspaceRevisions: (id: string) => ["session", id, "revisions"] as const,
  workspaceRevisionChanges: (id: string, revision: number) =>
    ["session", id, "revisions", revision, "changes"] as const,
};

export function useStoreInfo() {
  return useQuery<StoreInfo>({
    queryKey: queryKeys.storeInfo,
    queryFn: ({ signal }) => api.getStore(signal),
    staleTime: Infinity,
  });
}

/**
 * Whether this host can run sandboxed sessions. Probing spawns podman
 * subprocesses, so it runs only while a caller asks for it — today that is
 * the launch form with sandbox mode selected.
 */
export function useSandboxAvailability(enabled: boolean) {
  return useQuery<SandboxAvailability>({
    queryKey: queryKeys.sandboxAvailability,
    queryFn: ({ signal }) => api.getSandboxAvailability(signal),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Sandbox setup in progress for one launch (image pull, container start),
 * polled while the launch request is in flight so a minutes-long first pull
 * shows movement instead of a frozen button. Keyed by the launch id sent
 * with the create request, so concurrent launches stay independent.
 */
export function useSandboxActivity(enabled: boolean, key: string | null) {
  return useQuery<SandboxActivity | null>({
    queryKey: [...queryKeys.sandboxActivity, key],
    queryFn: ({ signal }) => api.getSandboxActivity(key as string, signal),
    enabled: enabled && key !== null,
    staleTime: 0,
    refetchInterval: 1000,
    retry: false,
  });
}

/**
 * Which API key names have a value stored in NAC home. Used to tell the user
 * whether a session can authenticate without the environment variable being
 * set; failures are non-fatal because the environment may well supply the key.
 */
export function useStoredCredentials(enabled = true) {
  return useQuery<StoredCredentialList>({
    queryKey: queryKeys.credentials,
    queryFn: ({ signal }) => api.listCredentials(signal),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useStoreCredential() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) =>
      api.storeCredential(name, value),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: queryKeys.credentials }),
  });
}

/**
 * Files a key away and reports the name it was given. Used where the key is the
 * thing the user supplies and the selector is an implementation detail.
 */
export function useStoreGeneratedCredential() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (value: string) => api.storeGeneratedCredential(value),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: queryKeys.credentials }),
  });
}

export function useDeleteCredential() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteCredential(name),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: queryKeys.credentials }),
  });
}

/**
 * Whether the providers that sign in through a browser are signed in. Reported
 * per provider rather than per configuration, because the credential is one
 * file in NAC home that every session using that backend shares.
 */
export function useManagedAuth(enabled = true) {
  return useQuery<ManagedAuthList>({
    queryKey: queryKeys.managedAuth,
    queryFn: ({ signal }) => api.listManagedAuth(signal),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useManagedLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (provider: ManagedAuthProvider) => api.managedLogout(provider),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.managedAuth });
      // The model index was only readable through the login that just went
      // away, so what is cached from it is no longer true — including the copy a
      // resolved configuration carries.
      client.removeQueries({ queryKey: queryKeys.managedProviderModelsAll });
      await client.invalidateQueries({
        queryKey: queryKeys.resolvedModelConfigsAll,
      });
      await client.invalidateQueries({
        queryKey: queryKeys.resolvedConfigFilesAll,
      });
    },
  });
}

export type BrowseKind = "directory" | "toml" | "file";

/**
 * Directory listing from the machine running the server. Only fetched while
 * the picker is open, and never cached long: the filesystem moves under us.
 */
export function useBrowsePath(
  path: string | null,
  kind: BrowseKind,
  hidden: boolean,
  enabled: boolean,
) {
  return useQuery<BrowseListing>({
    queryKey: queryKeys.browse(path ?? "", kind, hidden),
    queryFn: ({ signal }) => api.browsePath(path, kind, hidden, signal),
    enabled,
    staleTime: 2000,
    retry: false,
  });
}

/**
 * The same listing from an SSH host. Only directories come back, so a remote
 * working directory is picked the way a local one is.
 */
export function useSshBrowsePath(
  target: SshTarget | null,
  path: string | null,
  hidden: boolean,
  enabled: boolean,
) {
  return useQuery<BrowseListing>({
    queryKey: queryKeys.sshBrowse(target ?? { ssh_host: "" }, path ?? "", hidden),
    queryFn: ({ signal }) => api.browseSshPath(target!, path, hidden, signal),
    enabled: enabled && Boolean(target?.ssh_host),
    staleTime: 2000,
    retry: false,
  });
}

/**
 * Opens the connection the launch form needs before it can offer anything
 * remote, and reports the login home so the form can start there.
 *
 * A mutation rather than a query because connecting is the user pressing a
 * button, and because the ssh connection it leaves behind is a side effect the
 * session created next reuses.
 */
export function useSshConnect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (target: SshTarget) => api.browseSshPath(target, null),
    onSuccess: (listing, target) => {
      // Seeding the home listing means the picker opens without a second round
      // trip over a connection that was just paid for.
      client.setQueryData(queryKeys.sshBrowse(target, "", false), listing);
    },
  });
}

export function useSshConfigs() {
  return useQuery<SshConfigurationList>({
    queryKey: queryKeys.sshConfigs,
    queryFn: ({ signal }) => api.listSshConfigs(signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function useCreateSshConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSshConfigurationRequest) =>
      api.createSshConfig(payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.sshConfigs });
    },
  });
}

export function useUpdateSshConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      configId,
      payload,
    }: {
      configId: string;
      payload: UpdateSshConfigurationRequest;
    }) => api.updateSshConfig(configId, payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.sshConfigs });
    },
  });
}

export function useDeleteSshConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (configId: string) => api.deleteSshConfig(configId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.sshConfigs });
    },
  });
}

/**
 * Matches the server-side registry cache, so a fallback answer carrying only
 * the embedded entries is retried instead of pinned for the session.
 */
const MCP_LIBRARY_STALE_MS = 5 * 60 * 1000;

export function useMcpLibrary() {
  return useQuery<McpLibraryResponse>({
    queryKey: queryKeys.mcpLibrary,
    queryFn: ({ signal }) => api.getMcpLibrary(signal),
    staleTime: MCP_LIBRARY_STALE_MS,
    retry: false,
  });
}

export function useMcpServers() {
  return useQuery<McpServerList>({
    queryKey: queryKeys.mcpServers,
    queryFn: ({ signal }) => api.listMcpServers(signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function useCreateMcpServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateMcpServerRequest) =>
      api.createMcpServer(payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.mcpServers });
    },
  });
}

export function useUpdateMcpServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      serverName,
      payload,
    }: {
      serverName: string;
      payload: UpdateMcpServerRequest;
    }) => api.updateMcpServer(serverName, payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.mcpServers });
    },
  });
}

export function useDeleteMcpServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (serverName: string) => api.deleteMcpServer(serverName),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.mcpServers });
    },
  });
}

export function useTestMcpServer() {
  return useMutation({
    mutationFn: (payload: TestMcpServerRequest) => api.testMcpServer(payload),
  });
}

export function useModelConfigs() {
  return useQuery<ModelConfigurationList>({
    queryKey: queryKeys.modelConfigs,
    queryFn: ({ signal }) => api.listModelConfigs(signal),
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * The models an API key can reach, which is also how the key is validated: the
 * provider rejects the very same request when the key is wrong.
 *
 * The key appears in the query key so a corrected key refetches. That cache is
 * in memory for the lifetime of the tab and is never persisted.
 */
export function useProviderModels(
  backend: BackendKind,
  apiKey: string,
  baseUrl: string | null,
  enabled: boolean,
) {
  return useQuery<ProviderModelList>({
    queryKey: queryKeys.providerModels(backend, apiKey, baseUrl ?? ""),
    queryFn: () =>
      api.listProviderModels({ backend, api_key: apiKey, base_url: baseUrl }),
    enabled: enabled && apiKey.length > 0,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 60_000,
  });
}

/**
 * The same check as `useProviderModels` for a key that is already on file: the
 * server resolves the name and asks the provider, so an editor that never held
 * the secret can still tell whether it still works and what it can reach.
 */
export function useStoredKeyProviderModels(
  backend: BackendKind,
  apiKeyEnv: string,
  baseUrl: string | null,
  enabled: boolean,
) {
  return useQuery<ProviderModelList>({
    queryKey: queryKeys.storedKeyProviderModels(backend, apiKeyEnv, baseUrl ?? ""),
    queryFn: () =>
      api.listProviderModels({
        backend,
        api_key_env: apiKeyEnv,
        base_url: baseUrl,
      }),
    enabled: enabled && apiKeyEnv.length > 0,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 60_000,
  });
}

/**
 * The models a browser login can reach. There is no key to pass, so the stored
 * credential answers, and a rejection here means the login has gone stale.
 *
 * Invalidated when a login completes, which is what turns the model picker from
 * empty into populated without a reload.
 */
export function useManagedProviderModels(
  backend: BackendKind | null,
  enabled: boolean,
) {
  return useQuery<ProviderModelList>({
    queryKey: queryKeys.managedProviderModels(backend ?? ""),
    queryFn: () => api.listProviderModels({ backend: backend! }),
    enabled: enabled && backend !== null,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/**
 * Live model indexes for managed providers the catalog already marks ready.
 * Same `POST /providers/models` path Create New uses after login — Browse can
 * overlay these on the local catalog so Arcee/Codex show what the account can
 * actually reach. Failures leave that provider on its catalog entries.
 */
export function useReadyManagedProviderModels(
  catalog: ModelCatalog | undefined,
) {
  const ready = useMemo(
    () =>
      (catalog?.providers ?? []).filter(
        (provider) =>
          provider.auth_status === "ready" && provider.auth !== "api_key_env",
      ),
    [catalog],
  );
  const results = useQueries({
    queries: ready.map((provider) => ({
      queryKey: queryKeys.managedProviderModels(provider.id),
      queryFn: () => api.listProviderModels({ backend: provider.id }),
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });
  const live = new Map<BackendKind, ProviderModel[]>();
  ready.forEach((provider, index) => {
    const models = results[index]?.data?.models;
    if (models?.length) live.set(provider.id, models);
  });
  return live;
}

/**
 * The server's model catalog: context windows, prices and the efforts each
 * model accepts. It only changes when the server reloads it, and a failure is
 * never fatal — every consumer falls back to showing the raw numbers.
 */
export function useModelCatalog(enabled = true) {
  return useQuery<ModelCatalog>({
    queryKey: queryKeys.modelCatalog,
    queryFn: ({ signal }) => api.getModelCatalog(signal),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** Static slash-command metadata served from the core command registry. */
export function useSlashCommands() {
  return useQuery<SlashCommandDefinition[]>({
    queryKey: queryKeys.slashCommands,
    queryFn: ({ signal }) => api.listCommands(signal),
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * A saved configuration or a `config.toml`, checked end to end by the server:
 * the credential resolves and the provider answers with its model list.
 */
export function useResolvedModelConfig(configId: string | null, filePath: string) {
  const path = filePath.trim();
  return useQuery<ResolvedModelConfiguration>({
    queryKey: configId
      ? queryKeys.resolvedModelConfig(configId)
      : queryKeys.resolvedConfigFile(path),
    queryFn: () =>
      configId ? api.resolveModelConfig(configId) : api.resolveConfigFile(path),
    enabled: Boolean(configId ?? path),
    retry: false,
    staleTime: 60_000,
  });
}

export function useCreateModelConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateModelConfigurationRequest) =>
      api.createModelConfig(payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.modelConfigs });
      // The server files the key under a generated credential name.
      void client.invalidateQueries({ queryKey: queryKeys.credentials });
    },
  });
}

export function useUpdateModelConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      configId,
      payload,
    }: {
      configId: string;
      payload: UpdateModelConfigurationRequest;
    }) => api.updateModelConfig(configId, payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.modelConfigs });
      // A replaced key is filed under a new generated name and the old one goes.
      void client.invalidateQueries({ queryKey: queryKeys.credentials });
    },
  });
}

export function useDeleteModelConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (configId: string) => api.deleteModelConfig(configId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.modelConfigs });
      void client.invalidateQueries({ queryKey: queryKeys.credentials });
    },
  });
}

export function useSessions(pollMs = SESSIONS_POLL_MS) {
  return useQuery<ManagedSessionSummary[]>({
    queryKey: queryKeys.sessions(false),
    queryFn: ({ signal }) => api.listSessions(false, signal),
    refetchInterval: pollMs,
    staleTime: 0,
  });
}

export function mergeWorkspaceStats(
  base: ManagedSessionSummary[],
  stats: ManagedSessionSummary[],
): ManagedSessionSummary[] {
  const workspaceById = new Map(
    stats
      .filter((entry) => entry.workspace_diff !== undefined)
      .map((entry) => [entry.summary.session_id, entry.workspace_diff]),
  );
  return base.map((entry) => {
    const workspaceDiff = workspaceById.get(entry.summary.session_id);
    return workspaceDiff === undefined
      ? entry
      : { ...entry, workspace_diff: workspaceDiff };
  });
}

export function useSessionsWithWorkspaceStats(
  cadence: {
    baseMs: number;
    statsMs: number;
  } = {
    baseMs: SESSIONS_POLL_MS,
    statsMs: WORKSPACE_STATS_POLL_MS,
  },
) {
  const base = useSessions(cadence.baseMs);
  const stats = useQuery<ManagedSessionSummary[]>({
    queryKey: queryKeys.sessions(true),
    queryFn: ({ signal }) => api.listSessions(true, signal),
    refetchInterval: cadence.statsMs,
    staleTime: cadence.statsMs,
  });
  const data = useMemo(
    () =>
      base.data
        ? mergeWorkspaceStats(base.data, stats.data ?? [])
        : base.data,
    [base.data, stats.data],
  );
  return { ...base, data };
}

/**
 * The single summary a session screen needs, picked out of the polled list.
 *
 * Subscribing to the whole list would re-render the chat every five seconds
 * over changes to unrelated sessions; the selected entry keeps its identity
 * across a refetch that did not touch it, so the transcript stays put.
 */
export function useSessionSummary(id: string | null) {
  const select = useCallback(
    (sessions: ManagedSessionSummary[]) =>
      sessions.find((item) => item.summary.session_id === id) ?? null,
    [id],
  );
  return useQuery<
    ManagedSessionSummary[],
    Error,
    ManagedSessionSummary | null
  >({
    queryKey: queryKeys.sessions(false),
    queryFn: ({ signal }) => api.listSessions(false, signal),
    refetchInterval: SESSIONS_POLL_MS,
    staleTime: 0,
    select,
  });
}

export function useSessionSnapshot(
  id: string | null,
  options?: Partial<UseQueryOptions<SessionSnapshotResponse>>,
) {
  const client = useQueryClient();
  return useQuery<SessionSnapshotResponse>({
    queryKey: queryKeys.sessionSnapshot(id ?? ""),
    queryFn: async ({ signal }) => {
      const token = beginSnapshotFetch(id!);
      const incoming = await api.getSession(id!, {
        messageLimit: SNAPSHOT_MESSAGE_LIMIT,
        threadEventLimit: SNAPSHOT_THREAD_EVENT_LIMIT,
        includeSessions: false,
        includeSystem: true,
        signal,
      });
      if (!validSnapshotWindow(incoming)) {
        throw new Error("The server returned an invalid snapshot message page.");
      }
      if (
        signal.aborted ||
        !isCurrentSessionGeneration(id!, token.generation)
      ) {
        throw new DOMException("Snapshot superseded", "AbortError");
      }
      finishSnapshotFetch(id!, token);
      return mergeFocusedSnapshot(
        client.getQueryData<SessionSnapshotResponse>(queryKeys.sessionSnapshot(id!)),
        incoming,
        token.replace,
      );
    },
    enabled: Boolean(id),
    // The stream invalidates this query, so a stale time only guards bursts.
    staleTime: 1000,
    ...options,
  });
}
export function useLoadOlderMessages(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<boolean> => {
      const current = client.getQueryData<SessionSnapshotResponse>(
        queryKeys.sessionSnapshot(id),
      );
      const start = current?.message_page?.start;
      if (start === undefined || start <= 0) {
        throw new Error("No older messages are available.");
      }
      const generation = currentSessionGeneration(id);
      const page = await api.getMessages(id, {
        before: start,
        limit: SNAPSHOT_MESSAGE_LIMIT,
        includeSystem: true,
      });
      if (!validMessagesPage(page)) {
        throw new Error("The server returned an invalid message page.");
      }
      if (!isCurrentSessionGeneration(id, generation)) return false;

      let accepted = false;
      client.setQueryData<SessionSnapshotResponse>(
        queryKeys.sessionSnapshot(id),
        (latest) => {
          if (!latest) return latest;
          const merged = prependMessagePage(latest, page, start);
          if (!merged) return latest;
          accepted = true;
          return merged;
        },
      );
      return accepted;
    },
  });
}
export function useThreadEventPages(
  id: string | null,
  threadName: string | null,
) {
  return useInfiniteQuery<
    ThreadEventPage,
    Error,
    InfiniteData<ThreadEventPage, number | null>,
    ReturnType<typeof queryKeys.threadEvents>,
    number | null
  >({
    queryKey: queryKeys.threadEvents(id ?? "", threadName ?? ""),
    queryFn: ({ pageParam, signal }) =>
      api.getThreadEvents(id!, threadName!, {
        beforeId: pageParam ?? undefined,
        limit: SNAPSHOT_THREAD_EVENT_LIMIT,
        signal,
      }),
    initialPageParam: null,
    getNextPageParam: (lastPage) =>
      lastPage.has_older ? lastPage.next_before_id : undefined,
    enabled: Boolean(id && threadName),
    staleTime: Number.POSITIVE_INFINITY,
  });
}



export function useSessionConfig(id: string | null) {
  return useQuery<RawSessionConfig>({
    queryKey: queryKeys.sessionConfig(id ?? ""),
    queryFn: ({ signal }) => api.getConfig(id!, signal),
    enabled: Boolean(id),
  });
}

export function useWorkspaceDiff(
  id: string | null,
  path: string | null,
  stage: WorkspaceDiffStage | "all" = "all",
  context = 3,
  revision: number | null = null,
) {
  return useQuery<WorkspaceFileDiff>({
    queryKey: queryKeys.workspaceDiff(
      id ?? "",
      path ?? "",
      stage,
      context,
      revision,
    ),
    queryFn: ({ signal }) =>
      api.getWorkspaceDiff(id!, path!, { stage, context, revision, signal }),
    enabled: Boolean(id && path),
  });
}

/**
 * Every file git considers part of the project, for the Files tree. With a
 * revision it is the project as it stood at the end of that run instead, which
 * is frozen and therefore never goes stale.
 */
export function useWorkspaceFiles(
  id: string | null,
  revision: number | null = null,
) {
  return useQuery<WorkspaceFileList>({
    queryKey: queryKeys.workspaceFiles(id ?? "", revision),
    queryFn: ({ signal }) => api.getWorkspaceFiles(id!, revision, signal),
    enabled: Boolean(id),
    staleTime: revision == null ? 10_000 : Infinity,
  });
}

/** Contents of one file, shown when it has no diff to display. */
export function useWorkspaceFile(
  id: string | null,
  path: string | null,
  revision: number | null = null,
) {
  return useQuery<WorkspaceFileContent>({
    queryKey: queryKeys.workspaceFile(id ?? "", path ?? "", revision),
    queryFn: ({ signal }) => api.getWorkspaceFile(id!, path!, revision, signal),
    enabled: Boolean(id && path),
    staleTime: revision == null ? 10_000 : Infinity,
  });
}

/** Revisions captured for this session, newest first. */
export function useWorkspaceRevisions(id: string | null) {
  return useQuery<WorkspaceRevision[]>({
    queryKey: queryKeys.workspaceRevisions(id ?? ""),
    queryFn: ({ signal }) => api.getWorkspaceRevisions(id!, signal),
    enabled: Boolean(id),
    staleTime: 5000,
    retry: false,
  });
}

/** What the run behind a revision changed. Frozen, so it is cached for good. */
export function useWorkspaceRevisionChanges(
  id: string | null,
  revision: number | null,
) {
  return useQuery<WorkspaceRevisionChanges>({
    queryKey: queryKeys.workspaceRevisionChanges(id ?? "", revision ?? 0),
    queryFn: ({ signal }) =>
      api.getWorkspaceRevisionChanges(id!, revision!, signal),
    enabled: Boolean(id && revision != null),
    staleTime: Infinity,
  });
}

/**
 * Local branches of the session's checkout. Only fetched while the picker is
 * open, since it shells out to git on the host.
 */
export function useBranches(id: string | null, enabled: boolean) {
  return useQuery<BranchList>({
    queryKey: queryKeys.branches(id ?? ""),
    queryFn: ({ signal }) => api.getBranches(id!, signal),
    enabled: Boolean(id) && enabled,
    staleTime: 5000,
    retry: false,
  });
}

export function useSwitchBranch(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: SwitchBranchRequest) => api.switchBranch(id, payload),
    onSuccess: () => {
      // The checkout moved, so the branch label, the changed files and every
      // cached diff under this session are all stale.
      void client.invalidateQueries({ queryKey: queryKeys.branches(id) });
      void client.invalidateQueries({ queryKey: queryKeys.sessionRoot(id) });
      void client.invalidateQueries({ queryKey: queryKeys.sessionsAll });
    },
  });
}

export function useCommitWorkspace(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CommitWorkspaceRequest) =>
      api.commitWorkspace(id, payload),
    onSuccess: () => {
      // HEAD moved and the tree is clean again, so the changed-file list, every
      // cached diff and the branch's dirty flag are all stale. They hang off
      // the session key, which invalidates them as its prefix.
      void client.invalidateQueries({ queryKey: queryKeys.sessionRoot(id) });
      void client.invalidateQueries({ queryKey: queryKeys.sessionsAll });
    },
  });
}

/** Invalidate helpers shared by every mutation below. */
function useInvalidators() {
  const client = useQueryClient();
  return {
    sessions: () =>
      client.invalidateQueries({ queryKey: queryKeys.sessionsAll }),
    session: (id: string) =>
      client.invalidateQueries({
        queryKey: queryKeys.sessionSnapshot(id),
        exact: true,
      }),
    sessionRoot: (id: string) =>
      client.invalidateQueries({ queryKey: queryKeys.sessionRoot(id) }),
  };
}

export function useCreateSession() {
  const invalidate = useInvalidators();
  return useMutation({
    mutationFn: (payload: CreateSessionRequest) => api.createSession(payload),
    onSuccess: () => invalidate.sessions(),
  });
}

export function useDeleteSession() {
  const invalidate = useInvalidators();
  return useMutation({
    mutationFn: (id: string) => api.deleteSession(id),
    onSuccess: () => invalidate.sessions(),
  });
}

export interface RenameSessionVariables {
  id: string;
  /** Empty string restores the automatic title (the last prompt). */
  title: string;
  pinned: boolean;
  expectedVersion: number;
}

export function useUpdatePresentation() {
  const invalidate = useInvalidators();
  return useMutation({
    mutationFn: ({ id, title, pinned, expectedVersion }: RenameSessionVariables) =>
      api.updatePresentation(id, {
        title,
        pinned,
        expected_version: expectedVersion,
      }),
    onSuccess: () => invalidate.sessions(),
  });
}

/** Pin toggle is a presentation update that keeps the current title. */
export function useTogglePin() {
  const update = useUpdatePresentation();
  return {
    ...update,
    toggle: (summary: SessionSummarySnapshot) =>
      update.mutateAsync({
        id: summary.session_id,
        title: summary.title ?? "",
        pinned: !summary.pinned,
        expectedVersion: summary.presentation_version ?? 0,
      }),
  };
}

export interface MoveSessionOrderVariables {
  /** Full unfiltered list — `/sessions/order` requires entire pin-group membership. */
  sessions: ManagedSessionSummary[];
  sessionId: string;
  targetPinned: boolean;
  /** Index within the destination pin group after the move. */
  targetIndex: number;
}

/**
 * Reorder within a pin group, optionally pinning/unpinning first when the
 * destination group differs. One invalidation at the end.
 */
export function useMoveSessionOrder() {
  const invalidate = useInvalidators();
  return useMutation({
    mutationFn: async ({
      sessions,
      sessionId,
      targetPinned,
      targetIndex,
    }: MoveSessionOrderVariables) => {
      let entries = sessions;
      const entry = entries.find((e) => e.summary.session_id === sessionId);
      if (!entry) {
        throw new Error(`Session '${sessionId}' was not found`);
      }

      if (Boolean(entry.summary.pinned) !== targetPinned) {
        const summary = await api.updatePresentation(sessionId, {
          title: entry.summary.title ?? "",
          pinned: targetPinned,
          expected_version: entry.summary.presentation_version ?? 0,
        });
        entries = withUpdatedSummary(entries, summary);
      }

      const group = pinGroup(entries, targetPinned);
      const currentIds = group.map((e) => e.summary.session_id);
      const nextIds = placeSessionId(currentIds, sessionId, targetIndex);
      if (sameOrder(currentIds, nextIds)) return null;

      return api.reorderSessions(reorderRequest(targetPinned, nextIds, group));
    },
    onSuccess: () => invalidate.sessions(),
  });
}

export function useUpdateConfig() {
  const invalidate = useInvalidators();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateConfigRequest }) =>
      api.updateConfig(id, patch),
    onSuccess: (_data, { id }) => {
      void client.invalidateQueries({ queryKey: queryKeys.sessionConfig(id) });
      void invalidate.session(id);
      void invalidate.sessions();
    },
  });
}

export function useSubmitRun() {
  const invalidate = useInvalidators();
  return useMutation({
    mutationFn: ({ id, prompt }: { id: string; prompt: string }) =>
      api.submitRun(id, prompt),
    onMutate: ({ prompt }) => {
      setOptimisticUserPrompt(prompt);
    },
    onError: () => {
      setOptimisticUserPrompt(null);
    },
    onSuccess: (_data, { id }) => invalidate.session(id),
  });
}

export function useCancelRun() {
  const invalidate = useInvalidators();
  return useMutation({
    mutationFn: (id: string) => api.cancelActiveRun(id),
    onSuccess: (_data, id) => invalidate.session(id),
  });
}

export function useCompactSession() {
  const invalidate = useInvalidators();
  return useMutation({
    mutationFn: (id: string) => api.compactSession(id),
    onSuccess: (_data, id) => {
      fenceSessionSnapshot(id, true);
      return invalidate.sessionRoot(id);
    },
  });
}

/**
 * A revert rewrites the transcript and the checkout at once. Invalidating the
 * session root drops the snapshot, thread history, file data, and revision
 * views that the reverted state invalidated.
 */
export function useRevertSession() {
  const invalidate = useInvalidators();
  return useMutation({
    mutationFn: ({ id, messageIdx }: { id: string; messageIdx: number }) =>
      api.revertSession(id, messageIdx),
    onSuccess: (_data, { id }) => {
      fenceSessionSnapshot(id, true);
      void invalidate.sessionRoot(id);
      void invalidate.sessions();
    },
  });
}

/**
 * Answering a prompt again is a revert plus a run, so it drops the same views a
 * revert does before the new run starts filling them back in.
 */
export function useRegenerateRun() {
  const invalidate = useInvalidators();
  return useMutation({
    mutationFn: ({ id, messageIdx }: { id: string; messageIdx: number }) =>
      api.regenerateRun(id, messageIdx),
    onSuccess: (_data, { id }) => {
      fenceSessionSnapshot(id, true);
      void invalidate.sessionRoot(id);
      void invalidate.sessions();
    },
  });
}
