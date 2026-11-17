import type { TranscriptTurn } from "./transcript";
import type { WorkspaceRevision } from "../types/api";
/** How a revision is named once it is no longer the working tree. */
export declare const revisionTitle: (ordinal: number) => string;
/** The list arrives newest first, so the oldest revision is number one. */
export declare const revisionOrdinal: (index: number, total: number) => number;
/**
 * The revision each model turn was captured by, keyed by the turn's message
 * index, leaving out the runs that changed nothing — most of them, in a session
 * that mostly talks.
 *
 * Keyed by the message rather than by the turn so that a turn which is still
 * only a stream, and has no message to place it by, cannot read a revision at
 * all: it has nothing to look up with, whatever it happens to be keyed as.
 *
 * Walked in step rather than searched per turn so a revision is claimed once:
 * a run that finished without writing a message — a failure before the model
 * answered, or the very first capture, which carries whatever the checkout was
 * already carrying — would otherwise hand its revision to the next turn along.
 */
export declare function revisionsByTurn(turns: TranscriptTurn[], revisions: WorkspaceRevision[] | undefined): Map<number, WorkspaceRevision>;
