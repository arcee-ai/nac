import type { ToolCallRef } from "../../../../services/queries/toolCalls";
/** The part of a tool call a field shows. */
export type ItemCodeFieldSource = "arguments" | "output";
interface ItemCodeFieldProps {
    title: string;
    /** Some types draw the field without its heading; the title still names it. */
    showHeading?: boolean;
    /** `presentation.summary` for arguments, `presentation.resultPreview` for output. */
    shortContent: string;
    source: ItemCodeFieldSource;
    sessionId: string;
    /** `segmentCall(segment)`; null for the compact tool blocks of orchestrator sessions. */
    call: ToolCallRef | null;
}
/**
 * Every code field of the Insights items renders through here, so loading a
 * call's full arguments or output has a single owner. "Show full" needs the
 * call id to load them by.
 */
export declare function ItemCodeField({ title, showHeading, shortContent, source, sessionId, call, }: ItemCodeFieldProps): import("react").JSX.Element;
export {};
