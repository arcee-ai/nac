export declare const terminalKeys: {
    list: (sessionId: string) => readonly ["session", string, "user-terminals"];
    status: (sessionId: string, id: string) => readonly ["session", string, "user-terminal", string];
};
export declare function useUserTerminals(sessionId: string): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    protocol_version: number;
    terminals: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["UserTerminalResponse"][];
}>, Error>;
export declare function useUserTerminalStatus(sessionId: string, id: string): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    alive: boolean;
    cols: number;
    exit_code?: number | null;
    output_complete: boolean;
    output_error?: string | null;
    protocol_version: number;
    rows: number;
    terminal_id: string;
}>, Error>;
export declare function useOpenUserTerminal(sessionId: string): import("@tanstack/react-query").UseMutationResult<{
    alive: boolean;
    cols: number;
    exit_code?: number | null;
    output_complete: boolean;
    output_error?: string | null;
    protocol_version: number;
    rows: number;
    terminal_id: string;
}, Error, string, unknown>;
export declare function useCloseUserTerminal(sessionId: string, id: string): import("@tanstack/react-query").UseMutationResult<void, Error, void, unknown>;
export declare const executionKeys: {
    list: (sessionId: string) => readonly ["session", string, "executions"];
};
export declare function useExecutions(sessionId: string): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    executions: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ExecutionStatus"][];
    protocol_version: number;
}>, Error>;
export declare function useStopExecution(sessionId: string, id: string): import("@tanstack/react-query").UseMutationResult<void, Error, void, unknown>;
