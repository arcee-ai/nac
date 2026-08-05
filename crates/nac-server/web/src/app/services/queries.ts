// TanStack Query bindings for the nac API. Server state lives here; only
// client state (selection, filters, live run status) goes into the stores.

import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { api } from "@/app/services/api";
import type {
  BackendKind,
  BranchList,
  BrowseListing,
  CommitWorkspaceRequest,
  CreateModelConfigurationRequest,
  CreateSessionRequest,
  ManagedSessionSummary,
  ModelConfigurationList,
  ProviderModelList,
  RawSessionConfig,
  ManagedAuthList,
  ManagedAuthProvider,
  ResolvedModelConfiguration,
  SessionSnapshotResponse,
  SessionSummarySnapshot,
  StoredCredentialList,
  StoreInfo,
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

export const queryKeys = {
  storeInfo: ["store"] as const,
  credentials: ["credentials"] as const,
  managedAuth: ["managed-auth"] as const,
  modelConfigs: ["model-configs"] as const,
  browse: (path: string, kind: BrowseKind) => ["fs-browse", { path, kind }] as const,
  providerModels: (backend: string, apiKey: string, baseUrl: string) =>
    ["provider-models", { backend, apiKey, baseUrl }] as const,
  storedKeyProviderModels: (backend: string, apiKeyEnv: string, baseUrl: string) =>
    ["stored-key-provider-models", { backend, apiKeyEnv, baseUrl }] as const,
  managedProviderModels: (backend: string) =>
    ["managed-provider-models", backend] as const,
  managedProviderModelsAll: ["managed-provider-models"] as const,
  resolvedModelConfig: (configId: string) =>
    ["model-config-resolved", configId] as const,
  resolvedConfigFile: (path: string) => ["config-file-resolved", path] as const,
  sessions: (workspaceStats: boolean) => ["sessions", { workspaceStats }] as const,
  sessionsAll: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  sessionConfig: (id: string) => ["session", id, "config"] as const,
  workspaceDiff: (
    id: string,
    path: string,
    stage: WorkspaceDiffStage | "all",
    context: number,
    revision: number | null,
  ) =>
    ["session", id, "workspace-diff", { path, stage, context, revision }] as const,
  branches: (id: string) => ["session", id, "branches"] as const,
  workspaceFiles: (id: string, revision: number | null) =>
    ["session", id, "workspace-files", { revision }] as const,
  workspaceFile: (id: string, path: string, revision: number | null) =>
    ["session", id, "workspace-file", { path, revision }] as const,
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
      // away, so what is cached from it is no longer true.
      client.removeQueries({ queryKey: queryKeys.managedProviderModelsAll });
    },
  });
}

export type BrowseKind = "directory" | "toml";

/**
 * Directory listing from the machine running the server. Only fetched while
 * the picker is open, and never cached long: the filesystem moves under us.
 */
export function useBrowsePath(path: string | null, kind: BrowseKind, enabled: boolean) {
  return useQuery<BrowseListing>({
    queryKey: queryKeys.browse(path ?? "", kind),
    queryFn: ({ signal }) => api.browsePath(path, kind, signal),
    enabled,
    staleTime: 2000,
    retry: false,
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
  backend: BackendKind,
  enabled: boolean,
) {
  return useQuery<ProviderModelList>({
    queryKey: queryKeys.managedProviderModels(backend),
    queryFn: () => api.listProviderModels({ backend }),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
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

export function useSessions(workspaceStats = true) {
  return useQuery<ManagedSessionSummary[]>({
    queryKey: queryKeys.sessions(workspaceStats),
    queryFn: ({ signal }) => api.listSessions(workspaceStats, signal),
    refetchInterval: SESSIONS_POLL_MS,
    staleTime: 0,
  });
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
    queryKey: queryKeys.sessions(true),
    queryFn: ({ signal }) => api.listSessions(true, signal),
    refetchInterval: SESSIONS_POLL_MS,
    staleTime: 0,
    select,
    // Nothing here reads the fetch flags, and they flip twice per poll.
    notifyOnChangeProps: ["data"],
  });
}

export function useSessionSnapshot(
  id: string | null,
  options?: Partial<UseQueryOptions<SessionSnapshotResponse>>,
) {
  return useQuery<SessionSnapshotResponse>({
    queryKey: queryKeys.session(id ?? ""),
    queryFn: ({ signal }) => api.getSession(id!, signal),
    enabled: Boolean(id),
    // The stream invalidates this query, so a stale time only guards bursts.
    staleTime: 1000,
    ...options,
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
      void client.invalidateQueries({ queryKey: queryKeys.session(id) });
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
      void client.invalidateQueries({ queryKey: queryKeys.session(id) });
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
      client.invalidateQueries({ queryKey: queryKeys.session(id) }),
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
    onSuccess: (_data, id) => invalidate.session(id),
  });
}

/**
 * A revert rewrites the transcript and the checkout at once. The session key is
 * the prefix of every workspace key, so invalidating it also drops the file and
 * revision views, which would otherwise keep diffing against revisions the
 * revert has just discarded.
 */
export function useRevertSession() {
  const invalidate = useInvalidators();
  return useMutation({
    mutationFn: ({ id, messageIdx }: { id: string; messageIdx: number }) =>
      api.revertSession(id, messageIdx),
    onSuccess: (_data, { id }) => {
      void invalidate.session(id);
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
      void invalidate.session(id);
      void invalidate.sessions();
    },
  });
}
