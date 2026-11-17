import { type RefObject } from "react";
/** A non-empty selection that lies entirely inside one completed reply block. */
export interface TranscriptSelection {
    messageIndex: number;
    text: string;
    /** Where the selection starts within the rendered block, from 0 to 1. */
    hint: number;
    /** Viewport rectangle of the selection, for placing the affordance. */
    top: number;
    left: number;
}
/** Read the current document selection; null unless it is inside one block. */
export declare function readTranscriptSelection(container: HTMLElement | null): TranscriptSelection | null;
/**
 * Follow the person's text selection inside the transcript. Only selections
 * confined to one completed assistant prose block qualify; streaming text,
 * tool output and reasoning are never marked as sources.
 */
export declare function useTranscriptSelection(containerRef: RefObject<HTMLElement | null>, enabled: boolean): [TranscriptSelection | null, () => void];
