import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { nacClient } from "@/app/services/nacClient";
import { queryKeys } from "@/app/services/queries/keys";
import type { ShellCommandRequest } from "@/app/types/api";

export function useSubmitShellCommand(sessionId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (request: ShellCommandRequest) => nacClient.submitShellCommand(sessionId, request),
    retry: false,
    onSettled: () => cache.invalidateQueries({ queryKey: queryKeys.sessionSnapshot(sessionId) }),
  });
}

export function useCancelShellCommand(sessionId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => nacClient.cancelShellCommand(sessionId, requestId),
    retry: false,
    onSettled: () => cache.invalidateQueries({ queryKey: queryKeys.sessionSnapshot(sessionId) }),
  });
}

export function useShellOutput(
  sessionId: string,
  requestId: string,
  offset: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["session", sessionId, "human-shell-output", requestId, offset],
    queryFn: ({ signal }) => nacClient.getShellOutput(sessionId, requestId, offset, signal),
    enabled,
    retry: false,
  });
}
