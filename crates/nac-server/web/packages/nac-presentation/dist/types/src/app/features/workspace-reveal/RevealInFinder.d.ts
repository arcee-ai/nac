import type { SessionSnapshotResponse } from "../../types/api";
/** Passive eligibility only. The server revalidates the current persisted
 * backend/root and no-follow target for each explicit user invocation. */
export declare function RevealInFinder({ sessionId, snapshot, path, }: {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    path: string;
}): import("react").JSX.Element | null;
