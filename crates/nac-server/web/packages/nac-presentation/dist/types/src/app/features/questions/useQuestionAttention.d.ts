import type { QuestionRecord } from "../../types/api";
export interface QuestionAttention {
    /** The questions to present: the exact linked one, or every pending one. */
    questions: QuestionRecord[];
    /** Why an exact link shows no question, when it does not. */
    notice: {
        tone: "status" | "alert";
        text: string;
    } | null;
}
/**
 * The pending questions a view should present. An exact link (from a
 * notification) narrows the list to that request and never falls back to a
 * different pending question, which a previous answer must not reach.
 */
export declare function useQuestionAttention(sessionId: string, enabled: boolean): QuestionAttention;
