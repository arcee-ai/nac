export declare const executionHistoryKey: (sessionId: string) => readonly ["session", string, "execution-history"];
export declare function useExecutionHistory(sessionId: string): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    history: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ExecutionHistory"];
    protocol_version: number;
}>, Error>;
