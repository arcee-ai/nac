import type { ReactNode } from "react";
import type { InsightSegment } from "../../model/types";
/**
 * A failed call's error line is its result preview. When the backend cut the
 * preview, the line offers the call's full output the way a field does.
 */
export declare function useErrorLine(segment: InsightSegment, sessionId: string, failed: boolean): {
    message: string | null;
    action: ReactNode;
};
