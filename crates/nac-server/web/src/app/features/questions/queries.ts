import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { queryKeys } from "@/app/services/queries/keys";
import type { QuestionAnswer } from "@/app/types/api";

export const questionKey = (sessionId: string) => ["session", sessionId, "questions"] as const;

export function useTaskQuestions(sessionId: string, enabled: boolean) {
  const { api } = useNativeRuntime();
  return useQuery({
    queryKey: questionKey(sessionId),
    queryFn: ({ signal }) => api.taskQuestions(sessionId, signal),
    enabled,
    refetchInterval: enabled ? 1000 : false,
    staleTime: 0,
    retry: false,
  });
}

export function useAnswerTaskQuestion() {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, answer }: { sessionId: string; answer: QuestionAnswer }) =>
      api.answerTaskQuestion(sessionId, answer),
    retry: false,
    onSettled: (_data, _error, { sessionId }) =>
      Promise.all([
        client.invalidateQueries({ queryKey: questionKey(sessionId) }),
        client.invalidateQueries({ queryKey: queryKeys.sessionRoot(sessionId) }),
      ]),
  });
}

export function useCancelTaskQuestion() {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      requestId,
      revision,
    }: {
      sessionId: string;
      requestId: string;
      revision: number;
    }) => api.cancelTaskQuestion(sessionId, requestId, revision),
    retry: false,
    onSettled: (_data, _error, { sessionId }) =>
      client.invalidateQueries({ queryKey: questionKey(sessionId) }),
  });
}
