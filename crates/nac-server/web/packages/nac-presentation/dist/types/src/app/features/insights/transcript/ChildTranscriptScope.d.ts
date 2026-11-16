import { type ReactNode } from "react";
import type { TranscriptTurn } from "../../../lib/transcript";
/**
 * A child's transcript drawn inside its parent's session page: its rows read
 * the child's own turns instead of the page's, and no jump from them reaches
 * the parent's panels, whose selection belongs to the parent's transcript.
 */
export declare function ChildTranscriptScope({ sessionId, turns, children, }: {
    sessionId: string;
    /** The child's snapshot turns, without the stream folded in. */
    turns: readonly TranscriptTurn[];
    children: ReactNode;
}): import("react").JSX.Element;
