import type { QuestionAnswer } from "../../types/api";
export declare const questionKey: (sessionId: string) => readonly ["session", string, "questions"];
export declare function useTaskQuestions(sessionId: string, enabled: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    answer: import("../../types/openapi.generated").components["schemas"]["QuestionAnswerReceipt"] | null;
    continuation_state: string | null;
    created_at: string;
    goal_id: string | null;
    request: import("../../types/openapi.generated").components["schemas"]["QuestionRequest"];
    revision: number;
    status: string;
}[]>, Error>;
export declare function useAnswerTaskQuestion(): import("@tanstack/react-query").UseMutationResult<{
    answer: string;
    continuation_run_id: string;
    generation: string;
    inbox_item_id: number;
    request_id: string;
    revision: number;
    run_id: string;
    session_id: string;
}, Error, {
    sessionId: string;
    answer: QuestionAnswer;
}, unknown>;
export declare function useCancelTaskQuestion(): import("@tanstack/react-query").UseMutationResult<{
    answer: import("../../types/openapi.generated").components["schemas"]["QuestionAnswerReceipt"] | null;
    continuation_state: string | null;
    created_at: string;
    goal_id: string | null;
    request: import("../../types/openapi.generated").components["schemas"]["QuestionRequest"];
    revision: number;
    status: string;
}, Error, {
    sessionId: string;
    requestId: string;
    revision: number;
}, unknown>;
