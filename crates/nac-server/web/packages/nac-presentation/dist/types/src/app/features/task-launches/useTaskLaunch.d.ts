import type { TaskLaunchRequest } from "../../types/api";
export declare function useTaskLaunch(projectId: string): {
    inventory: import("@tanstack/react-query").UseQueryResult<NoInfer<{
        created_at: string;
        error?: string | null;
        first_input_id?: number | null;
        phase: import("../../types/openapi.generated").components["schemas"]["TaskLaunchPhase"];
        request: import("../../types/openapi.generated").components["schemas"]["TaskLaunchRequest"];
        session_id: string;
        session_present: boolean;
        source: import("../../types/openapi.generated").components["schemas"]["TaskLaunchSource"];
        updated_at: string;
        workspace_path: string;
    }[]>, Error>;
    start: import("@tanstack/react-query").UseMutationResult<{
        created_at: string;
        error?: string | null;
        first_input_id?: number | null;
        phase: import("../../types/openapi.generated").components["schemas"]["TaskLaunchPhase"];
        request: import("../../types/openapi.generated").components["schemas"]["TaskLaunchRequest"];
        session_id: string;
        session_present: boolean;
        source: import("../../types/openapi.generated").components["schemas"]["TaskLaunchSource"];
        updated_at: string;
        workspace_path: string;
    }, Error, {
        default_ref?: string | null;
        git_ref?: string | null;
        invoking_session_id?: string | null;
        project_id: string;
        prompt: string;
        request_id: string;
        title: string;
    }, unknown>;
    cancel: import("@tanstack/react-query").UseMutationResult<{
        created_at: string;
        error?: string | null;
        first_input_id?: number | null;
        phase: import("../../types/openapi.generated").components["schemas"]["TaskLaunchPhase"];
        request: import("../../types/openapi.generated").components["schemas"]["TaskLaunchRequest"];
        session_id: string;
        session_present: boolean;
        source: import("../../types/openapi.generated").components["schemas"]["TaskLaunchSource"];
        updated_at: string;
        workspace_path: string;
    }, Error, string, unknown>;
    receipt: {
        created_at: string;
        error?: string | null;
        first_input_id?: number | null;
        phase: import("../../types/openapi.generated").components["schemas"]["TaskLaunchPhase"];
        request: import("../../types/openapi.generated").components["schemas"]["TaskLaunchRequest"];
        session_id: string;
        session_present: boolean;
        source: import("../../types/openapi.generated").components["schemas"]["TaskLaunchSource"];
        updated_at: string;
        workspace_path: string;
    } | undefined;
    intent: {
        default_ref?: string | null;
        git_ref?: string | null;
        invoking_session_id?: string | null;
        project_id: string;
        prompt: string;
        request_id: string;
        title: string;
    } | null;
    launch: (request: Omit<TaskLaunchRequest, "request_id">) => void;
    retry: (request: TaskLaunchRequest) => void;
    newRequest: () => void;
};
