import type { SessionSnapshotResponse } from "../../types/api";
import type { RevealSelection } from "./selection";
/** Passive eligibility only. The server revalidates the current persisted
 * backend/root and no-follow target for each explicit user invocation. */
export declare function RevealInFinder({ sessionId, snapshot, path, origin, }: {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    path: string;
    origin: RevealSelection | null;
}): import("react").JSX.Element | null;
