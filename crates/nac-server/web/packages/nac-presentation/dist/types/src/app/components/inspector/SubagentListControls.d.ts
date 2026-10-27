import type { SessionSummarySnapshot } from "../../types/api";
/**
 * Pin and rename for a subagent's row. There is no delete: the server deletes
 * primary sessions only.
 */
export declare function SubagentRowActions({ summary, title, isMobile, }: {
    summary: SessionSummarySnapshot;
    title: string;
    isMobile: boolean;
}): import("react").JSX.Element;
