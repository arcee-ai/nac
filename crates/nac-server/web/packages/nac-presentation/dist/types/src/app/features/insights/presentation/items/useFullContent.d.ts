import { InsightItemCodeDisplayerState } from "../../../../atoms";
import { type ToolCallRef } from "../../../../services/queries/toolCalls";
/**
 * "Show full" over one call's content: Loading until the server answers, then
 * Expanded. "Hide" keeps the answer, so showing it again is instant; a failed
 * load returns to Default, where "Show full" retries it. A result reaches the
 * store only once the call's whole batch of parallel calls is done, so a view
 * of the output stays Loading until the answer has one.
 */
export declare function useFullContent(sessionId: string, call: ToolCallRef | null, needsOutput: boolean): {
    state: InsightItemCodeDisplayerState;
    content: NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }> | undefined;
    failed: boolean;
    showFull: () => void;
    hide: () => void;
};
