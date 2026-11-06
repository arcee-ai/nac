import type { FreshTaskDestination, HeartbeatAction, HeartbeatReceipt } from "../../../types/api";
export declare const freshScheduleKey: (projectId: string) => readonly ["fresh-task-schedules", string];
export declare function useFreshRetainedAllowance(projectId: string, onSuccess: () => void): {
    intent: {
        expected_revision: number;
        request_id: string;
        retained_limit: number;
    } | null;
    control: import("@tanstack/react-query").UseMutationResult<{
        allowance: import("../../../types/openapi.generated").components["schemas"]["FreshTaskRetainedAllowance"];
        request_id: string;
    }, Error, {
        expected_revision: number;
        request_id: string;
        retained_limit: number;
    }, unknown>;
    rejected: boolean;
    error: Error | null;
    submit: (expectedRevision: number, retainedLimit: number) => void;
    retry: () => void;
    reviewLatest: () => void;
};
export declare function useFreshTaskSchedules(projectId: string, scheduleId: string | null): {
    inventory: import("@tanstack/react-query").UseQueryResult<NoInfer<{
        anchor_ms: number;
        binding: import("../../../types/openapi.generated").components["schemas"]["HeartbeatBinding"];
        created_at_ms: number;
        next_due_ms: number;
        reason?: string | null;
        schedule_id: string;
        session_id?: string | null;
        spec: import("../../../types/openapi.generated").components["schemas"]["HeartbeatSpec"];
        starts: number;
        state: import("../../../types/openapi.generated").components["schemas"]["HeartbeatState"];
        time_used_ms: number;
        tokens_used: number;
        updated_at_ms: number;
        usage_unknown: boolean;
        version: number;
    }[]>, Error>;
    inspection: import("@tanstack/react-query").UseQueryResult<NoInfer<{
        heartbeat: import("../../../types/openapi.generated").components["schemas"]["HeartbeatInspection"];
        host_allowance: import("../../../types/openapi.generated").components["schemas"]["FreshTaskRetainedAllowance"];
        host_retained_limit: number;
        inventory: import("../../../types/openapi.generated").components["schemas"]["FreshTaskLaunchReceipt"][];
        launches: import("../../../types/openapi.generated").components["schemas"]["TaskLaunchRecord"][];
    }>, Error>;
    control: import("@tanstack/react-query").UseMutationResult<{
        active_occurrence?: import("../../../types/openapi.generated").components["schemas"]["HeartbeatOccurrence"] | null;
        occurrence?: import("../../../types/openapi.generated").components["schemas"]["HeartbeatOccurrence"] | null;
        request_id: string;
        schedule: import("../../../types/openapi.generated").components["schemas"]["HeartbeatSchedule"];
    }, Error, {
        creator_session_id?: string | null;
        destination?: import("../../../types/openapi.generated").components["schemas"]["FreshTaskDestination"] | null;
        operation: import("../../../types/openapi.generated").components["schemas"]["HeartbeatAction"];
        request_id: string;
    }, unknown>;
    intent: {
        creator_session_id?: string | null;
        destination?: import("../../../types/openapi.generated").components["schemas"]["FreshTaskDestination"] | null;
        operation: import("../../../types/openapi.generated").components["schemas"]["HeartbeatAction"];
        request_id: string;
    } | null;
    error: Error | null;
    submit: (operation: HeartbeatAction, destination: FreshTaskDestination | null, onSuccess?: (receipt: HeartbeatReceipt) => void) => void;
    retry: () => void;
    rejected: boolean;
    reviewLatest: () => void;
};
export declare function useFreshInitialInput(sessionId: string, inputId: number | null | undefined, present: boolean | undefined, settled?: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    cancelled_at?: string | null;
    client_id?: string | null;
    created_at: string;
    delivered_at?: string | null;
    delivered_run_id?: string | null;
    delivery: import("../../../../../packages/nac-client/src/openapi.generated").components["schemas"]["InboxDelivery"];
    id: number;
    prompt: string;
    session_id: string;
    status: import("../../../../../packages/nac-client/src/openapi.generated").components["schemas"]["InboxStatus"];
    target_run_id?: string | null;
    terminal_selection?: import("../../../../../packages/nac-client/src/openapi.generated").components["schemas"]["TerminalSelectionEvidence"] | null;
    updated_at: string;
    version: number;
} | null>, Error>;
