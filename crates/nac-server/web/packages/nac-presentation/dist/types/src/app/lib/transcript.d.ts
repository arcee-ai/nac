import { type DelegatedCompletion } from "../features/delegation/completion";
import { type ToolPresentation } from "./toolPresentation";
import { type ThreadLogLine } from "./threadLog";
import type { RuntimeThread } from "../store/runtimeStore";
import type { AgentEvent, DispatchWeight, SessionSnapshotResponse, ToolCall } from "../types/api";
/** Exact assistant marker written after any partial response on cancellation. */
export declare const RUN_CANCELLED_MARKER = "[run cancelled by user]";
/** Stored sentinel identifying an assistant response abandoned by run failure. */
export declare const RUN_FAILED_PARTIAL_MARKER = "[run failed after this partial assistant response]";
export type ThreadState = "running" | "pending" | "done" | "cancelled" | "error";
export interface TranscriptThread {
    /**
     * Identifies the dispatch behind the card rather than the thread behind it.
     * One name can be dispatched again — each dispatch is an episode of its own,
     * with its own log and its own result — so keying by name would tie every
     * card of that name together.
     */
    key: string;
    name: string;
    /** What the orchestrator asked the thread to do. */
    action: string;
    /** Weight class the dispatch was classified into, if any. */
    weight: DispatchWeight | null;
    /** What the thread reported once it was done, or its action before then. */
    summary: string;
    /** Commands the thread has issued, oldest first, for the tail on its card. */
    log: ThreadLogLine[];
    state: ThreadState;
}
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
    kind: "workset";
    key: string;
    worksetId: string;
    pending: boolean;
} | {
    kind: "tool";
    key: string;
    name: string;
    pending: boolean;
} | {
    kind: "tool-detail";
    key: string;
    presentation: ToolPresentation;
}
/** One assistant dispatch batch, split into topological DAG rows. */
 | {
    kind: "wave";
    key: string;
    rows: TranscriptThread[][];
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
}
export interface ModelTurn {
    kind: "model";
    key: string;
    blocks: TranscriptBlock[];
    /** How long the run behind this turn took, once it finished. */
    durationMs: number | null;
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
export type TranscriptTurn = UserTurn | ModelTurn | DelegatedCompletionTurn;
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
}
/** Public for the threads list, which ranks rows by the open DAG batch. */
export declare function dispatchThreadName(call: ToolCall): string;
/**
 * Latest dispatch prompt per thread, read off the orchestrator's own tool
 * calls. The live `thread_started` event cannot serve this: event sanitization
 * replaces the action with a fixed placeholder before it reaches the stream.
 */
export declare function dispatchActions(messages: SessionSnapshotResponse["messages"]): Record<string, string>;
/**
 * Split one assistant batch into Kahn levels using in-batch `threads` deps.
 * Cycles / duplicate names fall back to a single row so the UI still renders.
 */
export declare function partitionThreadCalls(calls: ToolCall[]): ToolCall[][];
/**
 * Thread names whose latest dispatch exists only because the user stopped the
 * run. A later dispatch of the same name — finished or still in flight —
 * drops off this set, so Continue does not keep painting the live card as
 * cancelled.
 *
 * A stop does not always write a tool result for every dispatch — a name that
 * never started has no `[tool call cancelled by user]` row. Those still belong
 * here: the run ended without them, so a checkmark would claim work that never
 * ran.
 */
export declare function cancelledThreadNames(messages: SessionSnapshotResponse["messages"]): Set<string>;
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
promptUncommitted?: boolean): TranscriptTurn[];
/**
 * Group the snapshot messages into user bubbles and model messages. Live thread
 * state comes from the SSE store so a wave animates before the snapshot lands.
 */
export declare function buildTranscript(snapshot: SessionSnapshotResponse | null, liveThreads: Record<string, RuntimeThread>, liveFinishedToolCalls?: Record<string, true>, livePrimaryToolEvents?: AgentEvent[], pendingPermissionCallIds?: ReadonlySet<string>): TranscriptTurn[];
