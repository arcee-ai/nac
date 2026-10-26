import { type TranscriptTurn } from "../../../lib/transcript";
import type { SessionSnapshotResponse, SubmittedUserMessageSnapshot } from "../../../types/api";
export interface TranscriptModel {
    /** The snapshot's turns with the live stream folded into them. */
    turns: TranscriptTurn[];
    /** The snapshot half alone, which stream deltas leave untouched. */
    snapshotTurns: TranscriptTurn[];
    running: boolean;
    optimisticPrompt: string | null;
    /** The prompt the active run stored, while the session is running. */
    submitted: SubmittedUserMessageSnapshot | null | undefined;
    pendingText: string;
    pendingSkills: string[] | null;
    /** The sent prompt has not reached the snapshot's turns yet. */
    showPending: boolean;
    /** The last turn exists only as a stream answering the pending prompt. */
    streamingTurn: boolean;
}
/**
 * The turns a session's chat shows: the snapshot's, plus whatever the live
 * stream and the prompt sent ahead of the snapshot add to them.
 */
export declare function useTranscriptModel(sessionId: string, snapshot: SessionSnapshotResponse | null): TranscriptModel;
