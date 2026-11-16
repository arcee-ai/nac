import type { ManagedSessionSummary, SessionSnapshotResponse } from "../../types/api";
/**
 * The usage readings the session menu lists: context, tokens, cost and the
 * run clock, from the live run while one is going and the persisted spend
 * otherwise. The same derivation the session header used to draw.
 */
export declare function useUsageReadings(sessionId: string, snapshot: SessionSnapshotResponse | null, entry: ManagedSessionSummary | null): {
    context: string;
    contextShare: string | null;
    input: string;
    output: string;
    cacheRead: string | null;
    cost: string;
    running: boolean;
    startedAt: number | null;
    lastElapsedMs: number | null;
};
