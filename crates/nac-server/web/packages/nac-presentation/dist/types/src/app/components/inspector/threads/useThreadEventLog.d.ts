import type { AgentEvent, SessionSnapshotResponse } from "../../../types/api";
export interface ThreadEventLog {
    /** The fetched history once a page arrives, the snapshot's events until then. */
    events: AgentEvent[] | undefined;
    hasOlder: boolean;
    loadingOlder: boolean;
    loadingInitial: boolean;
    historyError: string | null;
    loadOlder: () => Promise<void>;
    retry: () => Promise<void>;
}
/** One thread's persisted events, loaded a page at a time back from the newest. */
export declare function useThreadEventLog(snapshot: SessionSnapshotResponse | null, threadName: string | null): ThreadEventLog;
