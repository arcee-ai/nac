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
  CreateSessionRequest,
  ManagedSessionSummary,
  RawSessionConfig,
  SessionSnapshotResponse,
  SessionSummarySnapshot,
  StoreInfo,
  UpdateConfigRequest,
  WorkspaceDiffStage,
  WorkspaceFileDiff,
} from "@/app/types/api";

/** How often the session list is refreshed; the list has no event stream. */
export const SESSIONS_POLL_MS = 5000;

export const queryKeys = {
  storeInfo: ["store"] as const,
  sessions: (workspaceStats: boolean) => ["sessions", { workspaceStats }] as const,
  sessionsAll: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  sessionConfig: (id: string) => ["session", id, "config"] as const,
  workspaceDiff: (
    id: string,
    path: string,
    stage: WorkspaceDiffStage | "all",
    context: number,
  ) => ["session", id, "workspace-diff", { path, stage, context }] as const,
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
) {
  return useQuery<WorkspaceFileDiff>({
    queryKey: queryKeys.workspaceDiff(id ?? "", path ?? "", stage, context),
    queryFn: ({ signal }) =>
      api.getWorkspaceDiff(id!, path!, { stage, context, signal }),
    enabled: Boolean(id && path),
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
