import { type TranscriptTurn } from "../../../lib/transcript";
import type { SessionSnapshotResponse, SubmittedUserMessageSnapshot } from "../../../types/api";
export interface TranscriptModel {
    /** The snapshot's turns with the pending prompt and the live stream folded in. */
    turns: TranscriptTurn[];
    /**
     * The same turns without the stream, which deltas leave untouched — what a
     * row reads its neighbours from, so a delta does not re-render it.
     */
    baseTurns: TranscriptTurn[];
    running: boolean;
    optimisticPrompt: string | null;
    /** The prompt the active run stored, while the session is running. */
    submitted: SubmittedUserMessageSnapshot | null | undefined;
    pendingText: string;
    /** The sent prompt has not reached the snapshot's turns yet. */
    showPending: boolean;
    /** Key of the turn answering the newest prompt, streamed or committed. */
    replyKey: string;
}
/**
 * The turns a session's chat shows: the snapshot's, plus whatever the live
 * stream and the prompt sent ahead of the snapshot add to them.
 */
export declare function useTranscriptModel(sessionId: string, snapshot: SessionSnapshotResponse | null): TranscriptModel;
