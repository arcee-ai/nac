import type { WorkspaceDiffStage } from "../../types/api";
export declare function useWorkspaceDiff(id: string | null, path: string | null, stage?: WorkspaceDiffStage | "all", context?: number, revision?: number | null): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    error: string | null;
    old_path: string | null;
    path: string;
    sections: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffSection"][];
}>, Error>;
/**
 * Every file git considers part of the project, for the Files tree. With a
 * revision it is the project as it stood at the end of that run instead, which
 * is frozen and therefore never goes stale.
 */
export declare function useWorkspaceFiles(id: string | null, revision?: number | null): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    files: string[];
    truncated: boolean;
}>, Error>;
/** Contents of one file, shown when it has no diff to display. */
export declare function useWorkspaceFile(id: string | null, path: string | null, revision?: number | null): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    binary: boolean;
    content?: string | null;
    path: string;
    size: number;
    too_large: boolean;
}>, Error>;
/** Revisions captured for this session, newest first. */
export declare function useWorkspaceRevisions(id: string | null): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    additions: number;
    base_sha: string | null;
    branch: string | null;
    changed_files: number;
    commit_sha: string;
    created_at: string;
    deletions: number;
    id: number;
    label: string;
    run_id: string;
    session_id: string;
    transcript_len: number | null;
}[]>, Error>;
/** What the run behind a revision changed. Frozen, so it is cached for good. */
export declare function useWorkspaceRevisionChanges(id: string | null, revision: number | null): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    changed_files: import("../../types/openapi.generated").components["schemas"]["ChangedFileStat"][];
    error?: string | null;
    total_additions: number;
    total_deletions: number;
}>, Error>;
/**
 * Local branches of the session's checkout. Only fetched while the picker is
 * open, since it shells out to git on the host.
 */
export declare function useBranches(id: string | null, enabled: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    branches: import("../../types/openapi.generated").components["schemas"]["Branch"][];
    current?: string | null;
    dirty: boolean;
}>, Error>;
export declare function useSwitchBranch(id: string): import("@tanstack/react-query").UseMutationResult<{
    branches: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["Branch"][];
    current?: string | null;
    dirty: boolean;
}, Error, {
    create?: boolean;
    name: string;
}, unknown>;
export declare function useCommitWorkspace(id: string): import("@tanstack/react-query").UseMutationResult<{
    additions: number;
    branch?: string | null;
    deletions: number;
    files_changed: number;
    sha: string;
}, Error, {
    message: string;
}, unknown>;
