import type { NacClient } from "./nacClient.js";
import type { AttachUserTerminalRequest, PullUserTerminalRequest, ExecutionStatus } from "./types.js";
import { UserTerminalConnection, type UserTerminalRenderer, type UserTerminalConnectionOptions } from "./userTerminalConnection.js";
import type { UserTerminalApi } from "./userTerminalApi.js";
export declare function createExecutionApi(client: NacClient): {
    listExecutions: (session: string, signal?: AbortSignal) => Promise<{
        executions: import("./openapi.generated.js").components["schemas"]["ExecutionStatus"][];
        protocol_version: number;
    }>;
    attachExecution: (session: string, id: string, body: AttachUserTerminalRequest, signal?: AbortSignal) => Promise<{
        idle_expiry_ms: number;
        observer_id: string;
        protocol_version: number;
        terminal: import("./openapi.generated.js").components["schemas"]["UserTerminalResponse"];
    }>;
    pullExecution: (session: string, id: string, observer: string, body: PullUserTerminalRequest, signal?: AbortSignal) => Promise<{
        bytes: number[];
        caught_up: boolean;
        execution: import("./openapi.generated.js").components["schemas"]["ExecutionStatus"];
        gap: boolean;
        next_offset: string;
        observer_id: string;
        offset: string;
        protocol_version: number;
        requires_ack: boolean;
        retained_end: string;
        retained_start: string;
        segments: import("./openapi.generated.js").components["schemas"]["ExecutionOutputSegment"][];
        terminal: import("./openapi.generated.js").components["schemas"]["UserTerminalResponse"];
    }>;
    detachExecution: (session: string, id: string, observer: string, signal?: AbortSignal) => Promise<void>;
    stopExecution: (session: string, id: string) => Promise<void>;
};
export type ExecutionApi = ReturnType<typeof createExecutionApi>;
/** One ACK/reset/cancellation owner for every source. Pipes and agent PTYs have
 * no human input route; only a real human shell uses its existing input API. */
export declare function createExecutionConnection(api: ExecutionApi & Pick<UserTerminalApi, "inputUserTerminal" | "resizeUserTerminal">, session: string, source: ExecutionStatus, renderer: UserTerminalRenderer, options?: UserTerminalConnectionOptions): UserTerminalConnection;
