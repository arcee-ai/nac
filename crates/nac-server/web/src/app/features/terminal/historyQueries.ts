import { useQuery } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";

export const executionHistoryKey = (sessionId: string) =>
  ["session", sessionId, "execution-history"] as const;

export function useExecutionHistory(sessionId: string) {
  const { api } = useNativeRuntime();
  return useQuery({
    queryKey: executionHistoryKey(sessionId),
    queryFn: ({ signal }) => api.listExecutionHistory(sessionId, signal),
    retry: false,
    refetchInterval: 2000,
  });
}
