import type { ManagedSessionSummary, SessionSnapshotResponse } from "../../types/api";
export declare function localRevealRoot(sessionId: string, snapshot: SessionSnapshotResponse | null, entries: ManagedSessionSummary[] | undefined): string | null;
