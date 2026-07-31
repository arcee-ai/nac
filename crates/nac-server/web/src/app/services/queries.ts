// TanStack Query bindings for the nac API. Server state lives here; only
// client state (selection, filters, live run status) goes into the stores.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { api } from "@/app/services/api";
import type {
  BranchList,
  CreateSessionRequest,
  LaunchModelDefaults,
  LaunchModelDefaultsRequest,
  ManagedSessionSummary,
  RawSessionConfig,
  SessionSnapshotResponse,
  SessionSummarySnapshot,
  StoreInfo,
  SwitchBranchRequest,
  UpdateConfigRequest,
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
  sessions: (workspaceStats: boolean) => ["sessions", { workspaceStats }] as const,
  sessionsAll: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  sessionConfig: (id: string) => ["session", id, "config"] as const,
  launchDefaults: (cwd: string, sshHost: string) =>
    ["launch-defaults", { cwd, sshHost }] as const,
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

export function useSessions(workspaceStats = true) {
  return useQuery<ManagedSessionSummary[]>({
    queryKey: queryKeys.sessions(workspaceStats),
    queryFn: ({ signal }) => api.listSessions(workspaceStats, signal),
    refetchInterval: SESSIONS_POLL_MS,
    staleTime: 0,
  });
}

/**
 * Model defaults configured for a launch location. Failures are non-fatal: the
 * modal simply cannot pre-resolve a managed backend.
 */
export function useLaunchDefaults(location: LaunchModelDefaultsRequest, enabled = true) {
  return useQuery<LaunchModelDefaults>({
    queryKey: queryKeys.launchDefaults(location.cwd ?? "", location.ssh_host ?? ""),
    queryFn: ({ signal }) => api.launchDefaults(location, signal),
    enabled,
    staleTime: 60_000,
    retry: false,
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
