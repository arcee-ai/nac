export declare function useSubmitShellCommand(sessionId: string): {
    isPending: boolean;
    isError: boolean;
    error: Error | null;
    data: {
        accepted_at_epoch_ms: number;
        command: string;
        diagnostic?: string | null;
        exit_code?: number | null;
        finished_at_epoch_ms?: number | null;
        operation_id: string;
        output_id?: string | null;
        request_id: string;
        state: import("../../types/openapi.generated").components["schemas"]["ShellCommandState"];
        stderr: string;
        stdout: string;
        timeout_ms: number;
        transcript_index?: number | null;
    } | undefined;
    mutateAsync: (command: string) => Promise<{
        accepted_at_epoch_ms: number;
        command: string;
        diagnostic?: string | null;
        exit_code?: number | null;
        finished_at_epoch_ms?: number | null;
        operation_id: string;
        output_id?: string | null;
        request_id: string;
        state: import("../../types/openapi.generated").components["schemas"]["ShellCommandState"];
        stderr: string;
        stdout: string;
        timeout_ms: number;
        transcript_index?: number | null;
    }>;
};
export declare function useCancelShellCommand(sessionId: string): import("@tanstack/react-query").UseMutationResult<{
    accepted_at_epoch_ms: number;
    command: string;
    diagnostic?: string | null;
    exit_code?: number | null;
    finished_at_epoch_ms?: number | null;
    operation_id: string;
    output_id?: string | null;
    request_id: string;
    state: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ShellCommandState"];
    stderr: string;
    stdout: string;
    timeout_ms: number;
    transcript_index?: number | null;
}, Error, string, unknown>;
export declare function useShellOutput(sessionId: string, requestId: string, offset: number, enabled: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    content: string;
    eof: boolean;
    next_offset: number;
    offset: number;
    overflowed: boolean;
}>, Error>;
