export declare const selectionQuestionsKey: (sessionId: string) => readonly ["selection-questions", string];
/**
 * The chat's question history, kept apart from the transcript. It polls only
 * while a question is still being answered.
 */
export declare function useSelectionQuestions(sessionId: string, enabled: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    items: import("../../types/openapi.generated").components["schemas"]["SelectionQuestionResponse"][];
    limits: import("../../types/openapi.generated").components["schemas"]["SelectionQuestionLimits"];
}>, Error>;
export declare function useAskSelectionQuestion(sessionId: string): import("@tanstack/react-query").UseMutationResult<{
    question: import("../../types/openapi.generated").components["schemas"]["SelectionQuestionResponse"];
    replayed: boolean;
}, Error, {
    excerpt: string;
    question: string;
    request_key: string;
    selection_end: number;
    selection_start: number;
    source_content_sha256: string;
    source_message_index: number;
}, unknown>;
export declare function useCancelSelectionQuestion(sessionId: string): import("@tanstack/react-query").UseMutationResult<{
    answer: string | null;
    answer_truncated: boolean;
    completed_at: string | null;
    created_at: string;
    error: string | null;
    excerpt: string;
    model: import("../../types/openapi.generated").components["schemas"]["SelectionQuestionModel"];
    question: string;
    question_id: string;
    request_key: string;
    source: import("../../types/openapi.generated").components["schemas"]["SelectionQuestionSource"];
    status: import("../../types/openapi.generated").components["schemas"]["SelectionQuestionStatus"];
    tool_call_attempted: boolean;
    updated_at: string;
    usage: import("../../types/openapi.generated").components["schemas"]["TokenUsage"] | null;
}, Error, string, unknown>;
