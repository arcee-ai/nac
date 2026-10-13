import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";

export const terminalKeys = {
  list: (sessionId: string) => ["session", sessionId, "user-terminals"] as const,
  status: (sessionId: string, id: string) => ["session", sessionId, "user-terminal", id] as const,
};

export function useUserTerminals(sessionId: string) {
  const { api } = useNativeRuntime();
  return useQuery({
    queryKey: terminalKeys.list(sessionId),
    queryFn: ({ signal }) => api.listUserTerminals(sessionId, signal),
    retry: false,
    refetchInterval: 2000,
  });
}

export function useUserTerminalStatus(sessionId: string, id: string) {
  const { api } = useNativeRuntime();
  return useQuery({
    queryKey: terminalKeys.status(sessionId, id),
    queryFn: ({ signal }) => api.getUserTerminal(sessionId, id, signal),
    retry: false,
    refetchInterval: (query) =>
      !query.state.data || query.state.data.alive || !query.state.data.output_complete
        ? 1000
        : false,
  });
}

export function useOpenUserTerminal(sessionId: string) {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (launchId: string) =>
      api.openUserTerminal(sessionId, {
        protocol_version: 1,
        launch_id: launchId,
        cols: 80,
        rows: 24,
      }),
    retry: false,
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: terminalKeys.list(sessionId) }),
        client.invalidateQueries({ queryKey: executionKeys.list(sessionId) }),
      ]),
  });
}

export function useCloseUserTerminal(sessionId: string, id: string) {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.terminateTerminal(sessionId, id),
    retry: false,
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: terminalKeys.list(sessionId) }),
        client.invalidateQueries({ queryKey: terminalKeys.status(sessionId, id) }),
      ]),
  });
}

export const executionKeys = {
  list: (sessionId: string) => ["session", sessionId, "executions"] as const,
};
export function useExecutions(sessionId: string) {
  const { api } = useNativeRuntime();
  return useQuery({
    queryKey: executionKeys.list(sessionId),
    queryFn: ({ signal }) => api.listExecutions(sessionId, signal),
    retry: false,
    refetchInterval: 1000,
  });
}
export function useStopExecution(sessionId: string, id: string) {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.stopExecution(sessionId, id),
    retry: false,
    onSuccess: () => client.invalidateQueries({ queryKey: executionKeys.list(sessionId) }),
  });
}
