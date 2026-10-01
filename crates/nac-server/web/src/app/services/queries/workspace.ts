import { Atom } from "effect/reactivity";
import { Effect } from "effect";

import { idleAtom, nacAtoms, remoteAtom } from "@/app/effect/remote";
import { apiEffect } from "@/app/services/api";
import { refreshSessionList, refreshSessionRoot } from "@/app/services/queries/invalidation";
import { atomIds } from "@/app/services/queries/keys";
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
 * Last success for this session stays on screen while the next path or
 * revision is still loading. A different session does not reuse it.
 */
function sessionSticky(id: string, kind: string) {
  return { stickyGroup: `${atomIds.session(id)}\0${kind}` };
}

export function workspaceDiffKey(
  id: string,
  path: string,
  stage: WorkspaceDiffStage | "all",
  context: number,
  revision: number | null,
): string {
  return `${id}\0${stage}\0${context}\0${revision ?? ""}\0${path}`;
}

function readWorkspaceDiffKey(key: string) {
  const [id, stage, context, revision, ...path] = key.split("\0");
  return {
    id,
    path: path.join("\0"),
    stage: stage as WorkspaceDiffStage | "all",
    context: Number(context),
    revision: revision === "" ? null : Number(revision),
  };
}

export const workspaceDiffAtom = Atom.family((key: string) => {
  const { id, path, stage, context, revision } = readWorkspaceDiffKey(key);
  return remoteAtom(
    atomIds.workspaceDiff(id, path, stage, context, revision),
    () => apiEffect.getWorkspaceDiff(id, path, { stage, context, revision }),
    sessionSticky(id, "workspace-diff"),
  );
});

export function workspaceDiff(
  id: string | null,
  path: string | null,
  stage: WorkspaceDiffStage | "all" = "all",
  context = 3,
  revision: number | null = null,
) {
  return id && path
    ? workspaceDiffAtom(workspaceDiffKey(id, path, stage, context, revision))
    : idleAtom<WorkspaceFileDiff>();
}

/**
 * Every file git considers part of the project, for the Files tree. With a
 * revision it is the project as it stood at the end of that run instead, which
 * is frozen and therefore never goes stale.
 */
export function workspaceFilesKey(id: string, revision: number | null): string {
  return `${id}\0${revision ?? "live"}`;
}

export const workspaceFilesAtom = Atom.family((key: string) => {
  const separator = key.indexOf("\0");
  const id = key.slice(0, separator);
  const revisionText = key.slice(separator + 1);
  const revision = revisionText === "live" ? null : Number(revisionText);
  return remoteAtom(
    atomIds.workspaceFiles(id, revision),
    () => apiEffect.getWorkspaceFiles(id, revision),
    {
      staleMs: revision == null ? 10_000 : Number.POSITIVE_INFINITY,
      ...sessionSticky(id, "workspace-files"),
    },
  );
});

export function workspaceFiles(id: string | null, revision: number | null = null) {
  return id ? workspaceFilesAtom(workspaceFilesKey(id, revision)) : idleAtom<WorkspaceFileList>();
}

/** Contents of one file, shown when it has no diff to display. */
export function workspaceFileKey(id: string, path: string, revision: number | null): string {
  return `${id}\0${revision ?? ""}\0${path}`;
}

export const workspaceFileAtom = Atom.family((key: string) => {
  const first = key.indexOf("\0");
  const second = key.indexOf("\0", first + 1);
  const id = key.slice(0, first);
  const revisionText = key.slice(first + 1, second);
  const path = key.slice(second + 1);
  const revision = revisionText === "" ? null : Number(revisionText);
  return remoteAtom(
    atomIds.workspaceFile(id, path, revision),
    () => apiEffect.getWorkspaceFile(id, path, revision),
    {
      staleMs: revision == null ? 10_000 : Number.POSITIVE_INFINITY,
      ...sessionSticky(id, "workspace-file"),
    },
  );
});

export function workspaceFile(
  id: string | null,
  path: string | null,
  revision: number | null = null,
) {
  return id && path
    ? workspaceFileAtom(workspaceFileKey(id, path, revision))
    : idleAtom<WorkspaceFileContent>();
}

/** Revisions captured for this session, newest first. */
export const workspaceRevisionsAtom = Atom.family((id: string) =>
  remoteAtom(atomIds.workspaceRevisions(id), () => apiEffect.getWorkspaceRevisions(id), {
    staleMs: 5_000,
    retry: false,
  }),
);

export function workspaceRevisions(id: string | null) {
  return id ? workspaceRevisionsAtom(id) : idleAtom<WorkspaceRevision[]>();
}

/** What the run behind a revision changed. Frozen, so it is cached for good. */
export function workspaceRevisionChangesKey(id: string, revision: number): string {
  return `${id}\0${revision}`;
}

export const workspaceRevisionChangesAtom = Atom.family((key: string) => {
  const separator = key.indexOf("\0");
  const id = key.slice(0, separator);
  const revision = Number(key.slice(separator + 1));
  return remoteAtom(
    atomIds.workspaceRevisionChanges(id, revision),
    () => apiEffect.getWorkspaceRevisionChanges(id, revision),
    {
      staleMs: Number.POSITIVE_INFINITY,
      ...sessionSticky(id, "workspace-revision-changes"),
    },
  );
});

export function workspaceRevisionChanges(id: string | null, revision: number | null) {
  return id && revision != null
    ? workspaceRevisionChangesAtom(workspaceRevisionChangesKey(id, revision))
    : idleAtom<WorkspaceRevisionChanges>();
}

/**
 * Local branches of the session's checkout. Only fetched while the picker is
 * open, since it shells out to git on the host.
 */
export const branchesAtom = Atom.family((id: string) =>
  remoteAtom(atomIds.branches(id), () => apiEffect.getBranches(id), {
    staleMs: 5_000,
    retry: false,
  }),
);

export function branches(id: string | null, enabled: boolean) {
  return id && enabled ? branchesAtom(id) : idleAtom<BranchList>();
}

export const switchBranchAtom = nacAtoms.fn(
  (input: { id: string; payload: SwitchBranchRequest }, get) =>
    apiEffect.switchBranch(input.id, input.payload).pipe(
      // The checkout moved, so the branch label, the changed files and every
      // cached diff under this session are all stale.
      Effect.tap(() => Effect.promise(() => refreshSessionRoot(get.registry, input.id))),
      Effect.tap(() => Effect.promise(() => refreshSessionList(get.registry))),
    ),
);

export const commitWorkspaceAtom = nacAtoms.fn(
  (input: { id: string; payload: CommitWorkspaceRequest }, get) =>
    apiEffect.commitWorkspace(input.id, input.payload).pipe(
      // HEAD moved and the tree is clean again, so the changed-file list, every
      // cached diff and the branch's dirty flag are all stale.
      Effect.tap(() => Effect.promise(() => refreshSessionRoot(get.registry, input.id))),
      Effect.tap(() => Effect.promise(() => refreshSessionList(get.registry))),
    ),
);
