import type { FleetAttentionFrame, FleetAttentionSession, FleetAttentionSnapshot } from "../../types/api";
export interface FleetAttentionState {
    /** The project filter these sessions were read under; `null` is all. */
    scope: string | null;
    epoch: string | null;
    revision: number;
    sessions: ReadonlyMap<string, FleetAttentionSession>;
}
type Baseline = Pick<FleetAttentionSnapshot, "epoch" | "revision" | "sessions">;
type Changes = Extract<FleetAttentionFrame, {
    kind: "changes";
}>;
export declare const emptyFleetAttention: FleetAttentionState;
/** Newest-revision-wins merge of snapshots (stream or poll) and changes. */
export type FleetAttentionInput = (({
    kind: "snapshot";
} & Baseline) | Changes) & {
    scope: string | null;
};
export declare function applyFleetAttention(state: FleetAttentionState, input: FleetAttentionInput): FleetAttentionState;
type DecisionFacet = "permissions" | "questions" | "reviews";
export interface AttentionCoverage {
    /** Exact current decisions; non-empty means the session needs you. */
    pending: FleetAttentionSession["pending"];
    /** Facets the server could not observe: never read these as "none pending". */
    unknown: DecisionFacet[];
    /** Facets this session's topology does not report at all. */
    unsupported: DecisionFacet[];
}
export declare function attentionCoverage(session: FleetAttentionSession): AttentionCoverage;
/** Sessions with pending decisions, grouped under their lineage root. */
export declare function pendingByRoot(sessions: ReadonlyMap<string, FleetAttentionSession>): Map<string, FleetAttentionSession[]>;
export {};
