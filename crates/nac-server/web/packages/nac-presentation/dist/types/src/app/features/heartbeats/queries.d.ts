import type { HeartbeatReceipt } from "../../types/api";
import type { HeartbeatAction } from "../../types/api";
export declare const heartbeatKey: (sessionId: string) => readonly ["heartbeats", string];
export declare function useHeartbeats(sessionId: string, scheduleId: string | null, allChats?: boolean): {
    inventory: import("@tanstack/react-query").UseQueryResult<NoInfer<{
        anchor_ms: number;
        binding: import("../../types/openapi.generated").components["schemas"]["HeartbeatBinding"];
        created_at_ms: number;
        next_due_ms: number;
        reason?: string | null;
        schedule_id: string;
        session_id: string;
        spec: import("../../types/openapi.generated").components["schemas"]["HeartbeatSpec"];
        starts: number;
        state: import("../../types/openapi.generated").components["schemas"]["HeartbeatState"];
        time_used_ms: number;
        tokens_used: number;
        updated_at_ms: number;
        usage_unknown: boolean;
        version: number;
    }[]>, Error>;
    inspection: import("@tanstack/react-query").UseQueryResult<NoInfer<{
        history: import("../../types/openapi.generated").components["schemas"]["HeartbeatOccurrence"][];
        schedule: import("../../types/openapi.generated").components["schemas"]["HeartbeatSchedule"];
    }>, Error>;
    control: import("@tanstack/react-query").UseMutationResult<{
        active_occurrence?: import("../../types/openapi.generated").components["schemas"]["HeartbeatOccurrence"] | null;
        occurrence?: import("../../types/openapi.generated").components["schemas"]["HeartbeatOccurrence"] | null;
        request_id: string;
        schedule: import("../../types/openapi.generated").components["schemas"]["HeartbeatSchedule"];
    }, Error, {
        operation: import("../../types/openapi.generated").components["schemas"]["HeartbeatAction"];
        request_id: string;
    }, unknown>;
    intent: {
        operation: import("../../types/openapi.generated").components["schemas"]["HeartbeatAction"];
        request_id: string;
    } | null;
    error: Error | null;
    submit: (operation: HeartbeatAction, onSuccess?: (receipt: HeartbeatReceipt) => void) => void;
    dismissRejection: () => void;
    rejected: boolean;
    retry: () => void;
};
