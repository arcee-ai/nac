import { type DelegatedCompletion } from "../features/delegation/completion";
import { type ToolPresentation } from "./toolPresentation";
import type { AgentEvent, SessionSnapshotResponse } from "../types/api";
/** Exact assistant marker written after any partial response on cancellation. */
export declare const RUN_CANCELLED_MARKER = "[run cancelled by user]";
/** Stored sentinel identifying an assistant response abandoned by run failure. */
export declare const RUN_FAILED_PARTIAL_MARKER = "[run failed after this partial assistant response]";
export type TranscriptBlock = {
    kind: "thoughts";
    key: string;
    text: string;
    durationMs: number | null;
    /** The model is producing this reasoning right now. */
    streaming: boolean;
} | {
    kind: "text";
    key: string;
    text: string;
} | {
    kind: "tool";
    key: string;
    name: string;
    pending: boolean;
} | {
    kind: "tool-detail";
    key: string;
    presentation: ToolPresentation;
};
export interface UserTurn {
    kind: "user";
    key: string;
    text: string;
    /**
     * Skills expanded into this prompt, parsed from the stored message — null
     * for an ordinary prompt. Shown as the bubble's expansion indicator.
     */
    invokedSkills: string[] | null;
    /** Raw snapshot index, which is what a revert addresses the turn by. */
    messageIndex: number;
    /** When the message entered the transcript log, if the backend knows. */
    createdAt: string | null;
    /** Submitted but not in the snapshot yet, so its index is only expected. */
    pending?: true;
}
export interface ModelTurn {
    kind: "model";
    key: string;
    blocks: TranscriptBlock[];
    /** How long the run behind this turn took, once it finished. */
    durationMs: number | null;
    serviceTierReceipts?: {
        requested: string | null;
        served: string | null;
    }[];
    /**
     * Raw snapshot index of the turn's first message, which is what places it
     * against the transcript lengths the workspace revisions were captured at.
     * Null while the turn is only a stream and has nothing persisted yet.
     */
    messageIndex: number | null;
}
export interface DelegatedCompletionTurn {
    kind: "delegated-completion";
    key: string;
    completion: DelegatedCompletion;
    messageIndex: number;
    createdAt: string | null;
}
/**
 * A run NAC admitted for a durable goal. Its stored message is the control
 * prompt the model reads; the transcript shows only the goal and objective.
 */
export interface GoalContinuationTurn {
    kind: "goal-continuation";
    key: string;
    goalId: string;
    objective: string;
    /**
     * The goal's first run in a fully loaded transcript. Unknown, and so false,
     * while older messages are still unloaded.
     */
    first: boolean;
    messageIndex: number;
    createdAt: string | null;
}
export type TranscriptTurn = UserTurn | ModelTurn | DelegatedCompletionTurn | GoalContinuationTurn;
/**
 * Key of a model turn that exists only as a stream, with nothing persisted to
 * key it by. Committed turns are keyed by their message index, so this one is
 * named rather than numbered to keep the two apart.
 */
export declare const STREAMING_TURN_KEY = "model-streaming";
/** Model output that has arrived over the stream, prose and reasoning apart. */
export interface StreamedOutput {
    text: string;
    reasoning: string;
    /**
     * No more of it is coming, as its call was committed or its run ended, so
     * once the snapshot holds its answer it holds all of it.
     */
    settled?: boolean;
}
/**
 * Show model output that has reached the browser ahead of the snapshot.
 *
 * The buffers outlive the message being committed, so the text does not blink
 * out while the snapshot is refetched; what keeps it from being shown twice is
 * the check against what the snapshot already carries.
 *
 * Only the turn the output belongs to is rebuilt: earlier turns are handed back
 * by reference, and the array itself is returned unchanged when the stream adds
 * nothing. That is what lets a memoized row skip a delta that never moved it.
 */
export declare function withStreamedOutput(turns: TranscriptTurn[], stream: StreamedOutput,
/**
 * The prompt this output answers has not reached the snapshot yet, so a model
 * turn at the end of `turns` is the previous run's. Appending to it would put
 * this run's output inside that turn and read as its work — its duration, and
 * the snapshot its run captured, would then describe this output too.
 */
promptUncommitted?: boolean,
/**
 * Key of a turn the output has to open, since its first message is not
 * persisted yet. The default stays out of the committed namespace; a caller
 * passes a committed key only when it is the one this turn will be given.
 */
key?: string): TranscriptTurn[];
/** Group the snapshot messages into user bubbles and model messages. */
export declare function buildTranscript(snapshot: SessionSnapshotResponse | null, livePrimaryToolEvents?: AgentEvent[], pendingPermissionCallIds?: ReadonlySet<string>): TranscriptTurn[];
