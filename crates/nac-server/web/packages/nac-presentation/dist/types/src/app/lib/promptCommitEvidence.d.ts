import type { SessionSnapshotResponse } from "../types/api";
/** Proof is historical. Retire a local bubble only when its prompt is visible
 * at the verified index or has moved before the displayed system-inclusive window. */
export declare function promptCommitCovers(snapshot: SessionSnapshotResponse | null | undefined, runId: string | null | undefined, text: string | null | undefined): boolean;
