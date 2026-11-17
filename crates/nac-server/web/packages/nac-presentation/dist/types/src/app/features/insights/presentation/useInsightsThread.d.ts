import { type ThreadEventLog } from "../../../components/inspector/threads/useThreadEventLog";
import { type ThreadRunState } from "../../../components/inspector/threads/useThreadRunState";
import type { InsightTurnSection } from "../model/types";
import type { ThreadLogLine } from "../../../lib/threadLog";
import type { EpisodeSnapshot, SessionSnapshotResponse, ThreadSnapshot } from "../../../types/api";
export interface InsightsThreadPane {
    thread: ThreadSnapshot;
    action: string;
    episodes: EpisodeSnapshot[];
    liveLog: ThreadLogLine[];
    running: boolean;
    canSteer: boolean;
    eventLog: ThreadEventLog;
}
/**
 * Whether this session named the thread. A thread picked in another session
 * stays in the layout store and must not open here.
 */
export declare function useThreadOwnership(snapshot: SessionSnapshotResponse | null, timeline: readonly InsightTurnSection[], liveThreads: ThreadRunState["liveThreads"]): (name: string) => boolean;
/** The thread the detail shows, picked or the newest one. */
export declare function useInsightsThreadPane(snapshot: SessionSnapshotResponse | null, name: string | null, { liveThreads, runningNames }: ThreadRunState, canSteerWorkers: boolean): InsightsThreadPane | null;
