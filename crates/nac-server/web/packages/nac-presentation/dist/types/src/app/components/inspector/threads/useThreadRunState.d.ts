import type { RuntimeThread } from "../../../store/runtimeStore";
import type { SessionSnapshotResponse } from "../../../types/api";
export interface ThreadRunState {
    liveThreads: Record<string, RuntimeThread>;
    /** Also holds active snapshot names while the stream is still settling. */
    runningNames: ReadonlySet<string>;
    /** Active names still waiting on in-batch dependencies. */
    pendingNames: ReadonlySet<string>;
}
/**
 * Which of a session's threads run and which wait on their sources, merged
 * from the snapshot's active names and the live stream.
 */
export declare function useThreadRunState(snapshot: SessionSnapshotResponse | null): ThreadRunState;
/**
 * `runningNames` deliberately treats active snapshot entries as running
 * while SSE reconnects so the list and detail pane do not flash pending.
 * Steering is a capability boundary, however, and must wait for the live
 * `thread_started` state so a pending or just-finished worker never gains an
 * actionable control during that approximation window.
 */
export declare function canSteerThread(canSteerWorkers: boolean, live: RuntimeThread | undefined): boolean;
