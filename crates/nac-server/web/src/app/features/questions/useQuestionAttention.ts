import { useSearchParams } from "react-router-dom";

import { errorMessage } from "@/app/providers/ToastProvider";
import type { QuestionRecord } from "@/app/types/api";

import { useTaskQuestions } from "./queries";

export interface QuestionAttention {
  /** The questions to present: the exact linked one, or every pending one. */
  questions: QuestionRecord[];
  /** Why an exact link shows no question, when it does not. */
  notice: { tone: "status" | "alert"; text: string } | null;
}

/**
 * The pending questions a view should present. An exact link (from a
 * notification) narrows the list to that request and never falls back to a
 * different pending question, which a previous answer must not reach.
 */
export function useQuestionAttention(sessionId: string, enabled: boolean): QuestionAttention {
  const [params] = useSearchParams();
  const selected = params.get("question_request");
  const query = useTaskQuestions(sessionId, enabled);
  if (!enabled) return { questions: [], notice: null };
  const pending = query.data?.filter((question) => question.status === "pending") ?? [];
  if (!selected) return { questions: pending, notice: null };
  const exact = pending.find((question) => question.request.request_id === selected);
  if (exact) return { questions: [exact], notice: null };
  if (query.isLoading) {
    return { questions: [], notice: { tone: "status", text: "Loading the exact task question…" } };
  }
  if (query.isError) {
    return { questions: [], notice: { tone: "alert", text: errorMessage(query.error) } };
  }
  if (query.isSuccess) {
    return {
      questions: [],
      notice: {
        tone: "status",
        text: "This task question is no longer pending. A previous answer cannot answer a replacement question.",
      },
    };
  }
  return { questions: [], notice: null };
}
