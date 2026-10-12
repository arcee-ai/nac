import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { ApiError, UncertainCommandAdmissionError } from "@/app/services/nacClient";
import { HumanCommandFailure, runHumanCommand, submitHumanCommand } from "./workflow";
import { queryKeys } from "@/app/services/queries/keys";

export function useSubmitShellCommand(sessionId: string) {
  const cache = useQueryClient();
  const {
    api,
    stores: {
      composerStore: { shellIntents },
    },
  } = useNativeRuntime();
  const attempts = useRef(new Map<string, string>()).current;
  const mutation = useMutation({
    // Only this opaque handle enters the mutation cache, never the raw draft.
    mutationFn: (attemptId: string) => {
      const command = attempts.get(attemptId);
      attempts.delete(attemptId);
      if (command === undefined) throw new Error("Command attempt is unavailable.");
      return runHumanCommand(
        submitHumanCommand({
          sessionId,
          command,
          intents: shellIntents,
          submit: (request) =>
            api.submitShellCommand(sessionId, request).catch((cause: unknown) => {
              throw new HumanCommandFailure({
                kind:
                  cause instanceof ApiError
                    ? "rejected"
                    : cause instanceof DOMException && cause.name === "AbortError"
                      ? "not-sent"
                      : "uncertain",
                cause,
              });
            }),
          lookup: (requestId) =>
            api.getShellCommand(sessionId, requestId).catch((cause: unknown) => {
              throw new HumanCommandFailure({
                kind: "uncertain",
                cause: new UncertainCommandAdmissionError(requestId, cause),
              });
            }),
          settled: () => {
            void cache.invalidateQueries({ queryKey: queryKeys.sessionRoot(sessionId) });
            void cache.invalidateQueries({ queryKey: queryKeys.sessionsAll });
          },
        }),
      );
    },
    retry: false,
  });
  const mutate = mutation.mutateAsync;
  const mutateAsync = useCallback(
    (command: string) => {
      const attemptId = crypto.randomUUID();
      attempts.set(attemptId, command);
      return mutate(attemptId).finally(() => attempts.delete(attemptId));
    },
    [attempts, mutate],
  );
  return {
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    data: mutation.data,
    mutateAsync,
  };
}

export function useCancelShellCommand(sessionId: string) {
  const { api } = useNativeRuntime();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => api.cancelShellCommand(sessionId, requestId),
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
  const { api } = useNativeRuntime();
  return useQuery({
    queryKey: ["session", sessionId, "human-shell-output", requestId, offset],
    queryFn: ({ signal }) => api.getShellOutput(sessionId, requestId, offset, signal),
    enabled,
    retry: false,
  });
}
