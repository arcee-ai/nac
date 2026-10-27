import type { TranscriptTurn } from "../../../lib/transcript";
/** Turns as they were last drawn, with the window their indexes were read in. */
export interface DrawnTurns {
    turns: readonly TranscriptTurn[];
    windowStart: number;
}
/**
 * Key every committed model turn by the first message it spans, unless it
 * overlaps a turn already drawn, whose key it keeps. A reply grows at its end
 * while it runs, and a refetch can cut its start off the message window, or a
 * page of older messages can extend it; keyed by either edge alone, the whole
 * message would remount, its code blocks repainting before they highlight.
 *
 * The first key is also the one a stream is drawn under before anything of the
 * reply is committed: the message right after the prompt it answers.
 */
export declare function keepTurnKeys(turns: TranscriptTurn[], windowStart: number, drawn: DrawnTurns | null): TranscriptTurn[];
/** Key of the model turn that will answer whatever the last turn asked. */
export declare function replyKey(turns: readonly TranscriptTurn[], windowStart: number): string;
