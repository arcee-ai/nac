import { type ReasoningSegment } from "./itemContent";
/** One disclosure per real reasoning segment; timing remains transcript-owned. */
export declare function ReasoningItem({ segment, active }: {
    segment: ReasoningSegment;
    active: boolean;
}): import("react").JSX.Element | null;
