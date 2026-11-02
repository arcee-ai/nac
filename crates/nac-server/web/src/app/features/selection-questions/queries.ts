import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type {
  AskSelectionQuestionRequest,
  SelectionQuestion,
  SelectionQuestionList,
} from "@/app/types/api";

export const selectionQuestionsKey = (sessionId: string) =>
  ["selection-questions", sessionId] as const;

/** Merge one record into the cached history without reordering it. */
function acceptQuestion(
  previous: SelectionQuestionList | undefined,
  incoming: SelectionQuestion,
): SelectionQuestionList | undefined {
  if (!previous) return previous;
  const known = previous.items.some((item) => item.question_id === incoming.question_id);
  return {
    ...previous,
    items: known
      ? previous.items.map((item) => (item.question_id === incoming.question_id ? incoming : item))
      : [...previous.items, incoming],
  };
}

/**
 * The chat's question history, kept apart from the transcript. It polls only
 * while a question is still being answered.
 */
export function useSelectionQuestions(sessionId: string, enabled: boolean) {
  const { api } = useNativeRuntime();
  return useQuery<SelectionQuestionList>({
    queryKey: selectionQuestionsKey(sessionId),
    queryFn: ({ signal }) => api.listSelectionQuestions(sessionId, signal),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.status === "pending") ? 1_000 : false,
    staleTime: 0,
    retry: false,
  });
}

export function useAskSelectionQuestion(sessionId: string) {
  const { api } = useNativeRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    // A retry is an explicit person's action that reuses the same request key.
    retry: false,
    mutationFn: (body: AskSelectionQuestionRequest) => api.askSelectionQuestion(sessionId, body),
    onSuccess: (response) => {
      queryClient.setQueryData<SelectionQuestionList>(
        selectionQuestionsKey(sessionId),
        (previous) => acceptQuestion(previous, response.question),
      );
      void queryClient.invalidateQueries({
        queryKey: selectionQuestionsKey(sessionId),
      });
    },
  });
}

export function useCancelSelectionQuestion(sessionId: string) {
  const { api } = useNativeRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (questionId: string) => api.cancelSelectionQuestion(sessionId, questionId),
    onSuccess: (question) => {
      queryClient.setQueryData<SelectionQuestionList>(
        selectionQuestionsKey(sessionId),
        (previous) => acceptQuestion(previous, question),
      );
    },
  });
}
