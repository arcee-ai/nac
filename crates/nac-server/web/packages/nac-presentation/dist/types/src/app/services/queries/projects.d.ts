import type { DeleteProjectSessions, ProjectRecord, UpdateProjectRequest } from "../../types/api";
/**
 * Projects have no event stream, so this refetches on the same cadence as the
 * session list rather than polling: every project mutation invalidates it.
 */
export declare function useProjects(): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    projects: import("../../types/openapi.generated").components["schemas"]["ProjectRecord"][];
}>, Error>;
export declare function useCreateProject(): import("@tanstack/react-query").UseMutationResult<{
    created_at: string;
    cwd: string;
    default_model_config_id?: string | null;
    description?: string | null;
    name: string;
    pinned: boolean;
    presentation_version: number;
    project_id: string;
    sort_order: number;
    ssh_host?: string | null;
    ssh_identity_file?: string | null;
    ssh_port?: number | null;
    updated_at: string;
}, Error, {
    cwd: string;
    default_model_config_id?: string | null;
    description?: string | null;
    name?: string | null;
    ssh_host?: string | null;
    ssh_identity_file?: string | null;
    ssh_port?: number | null;
}, unknown>;
export interface UpdateProjectVariables {
    projectId: string;
    payload: UpdateProjectRequest;
}
export declare function useUpdateProject(): import("@tanstack/react-query").UseMutationResult<{
    created_at: string;
    cwd: string;
    default_model_config_id?: string | null;
    description?: string | null;
    name: string;
    pinned: boolean;
    presentation_version: number;
    project_id: string;
    sort_order: number;
    ssh_host?: string | null;
    ssh_identity_file?: string | null;
    ssh_port?: number | null;
    updated_at: string;
}, Error, UpdateProjectVariables, unknown>;
/** Pin toggle mirrors the session one: same shape, no title to preserve. */
export declare function useToggleProjectPin(): {
    toggle: (project: ProjectRecord) => Promise<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }>;
    data: undefined;
    variables: undefined;
    error: null;
    isError: false;
    isIdle: true;
    isPending: false;
    isSuccess: false;
    status: "idle";
    mutate: import("@tanstack/react-query").UseMutateFunction<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }, Error, UpdateProjectVariables, unknown>;
    reset: () => void;
    context: unknown;
    failureCount: number;
    failureReason: Error | null;
    isPaused: boolean;
    submittedAt: number;
    mutateAsync: import("@tanstack/react-query").UseMutateAsyncFunction<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }, Error, UpdateProjectVariables, unknown>;
} | {
    toggle: (project: ProjectRecord) => Promise<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }>;
    data: undefined;
    variables: UpdateProjectVariables;
    error: null;
    isError: false;
    isIdle: false;
    isPending: true;
    isSuccess: false;
    status: "pending";
    mutate: import("@tanstack/react-query").UseMutateFunction<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }, Error, UpdateProjectVariables, unknown>;
    reset: () => void;
    context: unknown;
    failureCount: number;
    failureReason: Error | null;
    isPaused: boolean;
    submittedAt: number;
    mutateAsync: import("@tanstack/react-query").UseMutateAsyncFunction<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }, Error, UpdateProjectVariables, unknown>;
} | {
    toggle: (project: ProjectRecord) => Promise<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }>;
    data: undefined;
    error: Error;
    variables: UpdateProjectVariables;
    isError: true;
    isIdle: false;
    isPending: false;
    isSuccess: false;
    status: "error";
    mutate: import("@tanstack/react-query").UseMutateFunction<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }, Error, UpdateProjectVariables, unknown>;
    reset: () => void;
    context: unknown;
    failureCount: number;
    failureReason: Error | null;
    isPaused: boolean;
    submittedAt: number;
    mutateAsync: import("@tanstack/react-query").UseMutateAsyncFunction<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }, Error, UpdateProjectVariables, unknown>;
} | {
    toggle: (project: ProjectRecord) => Promise<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }>;
    data: {
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    };
    error: null;
    variables: UpdateProjectVariables;
    isError: false;
    isIdle: false;
    isPending: false;
    isSuccess: true;
    status: "success";
    mutate: import("@tanstack/react-query").UseMutateFunction<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }, Error, UpdateProjectVariables, unknown>;
    reset: () => void;
    context: unknown;
    failureCount: number;
    failureReason: Error | null;
    isPaused: boolean;
    submittedAt: number;
    mutateAsync: import("@tanstack/react-query").UseMutateAsyncFunction<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }, Error, UpdateProjectVariables, unknown>;
};
export interface DeleteProjectVariables {
    projectId: string;
    /** Whether the project's chats go with it. Defaults to keeping them. */
    sessions?: DeleteProjectSessions;
}
/** Either way the project's sessions move, so the session list moves too. */
export declare function useDeleteProject(): import("@tanstack/react-query").UseMutationResult<{
    deleted_session_ids: string[];
    released_session_ids: string[];
}, Error, DeleteProjectVariables, unknown>;
export interface AssignSessionVariables {
    projectId: string;
    sessionId: string;
}
export declare function useAssignSessionToProject(): import("@tanstack/react-query").UseMutationResult<{
    created_at: string;
    cwd: string;
    default_model_config_id?: string | null;
    description?: string | null;
    name: string;
    pinned: boolean;
    presentation_version: number;
    project_id: string;
    sort_order: number;
    ssh_host?: string | null;
    ssh_identity_file?: string | null;
    ssh_port?: number | null;
    updated_at: string;
}, Error, AssignSessionVariables, unknown>;
export interface MoveProjectOrderVariables {
    /** Full list — `/projects/order` requires entire pin-group membership. */
    projects: ProjectRecord[];
    projectId: string;
    targetPinned: boolean;
    /** Index within the destination pin group after the move. */
    targetIndex: number;
}
/**
 * Reorder within a pin group, pinning or unpinning first when the destination
 * group differs. The pin toggle rewrites versions, so the group is re-read from
 * its response before the order request is built.
 */
export declare function useMoveProjectOrder(): import("@tanstack/react-query").UseMutationResult<void, Error, MoveProjectOrderVariables, unknown>;
