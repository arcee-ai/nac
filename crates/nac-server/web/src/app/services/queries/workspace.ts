import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import type {
  BranchList,
  CommitWorkspaceRequest,
  SwitchBranchRequest,
  WorkspaceDiffStage,
  WorkspaceFileContent,
  WorkspaceFileDiff,
  WorkspaceFileList,
  WorkspaceRevision,
  WorkspaceRevisionChanges,
} from "@/app/types/api";

/**
 * Keeps the answer already on screen while the next one is fetched, so asking
 * the same panel a slightly different question — another revision, another
 * file — reads as the panel changing rather than reloading.
 *
 * Only within one session: every session-scoped key starts `["session", id]`,
 * and a different session's files under this one's heading would be a lie
 * rather than a stale truth. The hairline bar on the panel says a fetch is
 * still running.
 */
function previousDataFrom(sessionId: string) {
  return <T>(previous: T | undefined, previousQuery?: { queryKey: readonly unknown[] }) =>
    previousQuery?.queryKey[1] === sessionId ? previous : undefined;
}

export function useWorkspaceDiff(
  id: string | null,
  path: string | null,
  stage: WorkspaceDiffStage | "all" = "all",
  context = 3,
  revision: number | null = null,
) {
  return useQuery<WorkspaceFileDiff>({
    queryKey: queryKeys.workspaceDiff(id ?? "", path ?? "", stage, context, revision),
    queryFn: ({ signal }) => api.getWorkspaceDiff(id!, path!, { stage, context, revision, signal }),
    enabled: Boolean(id && path),
    placeholderData: previousDataFrom(id ?? ""),
  });
}

/**
 * Every file git considers part of the project, for the Files tree. With a
 * revision it is the project as it stood at the end of that run instead, which
 * is frozen and therefore never goes stale.
 */
export function useWorkspaceFiles(id: string | null, revision: number | null = null) {
  return useQuery<WorkspaceFileList>({
    queryKey: queryKeys.workspaceFiles(id ?? "", revision),
    queryFn: ({ signal }) => api.getWorkspaceFiles(id!, revision, signal),
    enabled: Boolean(id),
    staleTime: revision == null ? 10_000 : Infinity,
    placeholderData: previousDataFrom(id ?? ""),
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
    placeholderData: previousDataFrom(id ?? ""),
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
export function useWorkspaceRevisionChanges(id: string | null, revision: number | null) {
  return useQuery<WorkspaceRevisionChanges>({
    queryKey: queryKeys.workspaceRevisionChanges(id ?? "", revision ?? 0),
    queryFn: ({ signal }) => api.getWorkspaceRevisionChanges(id!, revision!, signal),
    enabled: Boolean(id && revision != null),
    staleTime: Infinity,
    placeholderData: previousDataFrom(id ?? ""),
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
    mutationFn: (payload: CommitWorkspaceRequest) => api.commitWorkspace(id, payload),
    onSuccess: () => {
      // HEAD moved and the tree is clean again, so the changed-file list, every
      // cached diff and the branch's dirty flag are all stale. They hang off
      // the session key, which invalidates them as its prefix.
      void client.invalidateQueries({ queryKey: queryKeys.sessionRoot(id) });
      void client.invalidateQueries({ queryKey: queryKeys.sessionsAll });
    },
  });
}
