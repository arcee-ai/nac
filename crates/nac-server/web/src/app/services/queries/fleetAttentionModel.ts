// Pure fleet attention state helpers (no React/runtime), shared by the hook
// and by Node-side checks such as the production e2e (hence relative imports).
import type {
  AttentionFacet,
  FleetAttentionFrame,
  FleetAttentionSession,
  FleetAttentionSnapshot,
} from "../../types/api";

export interface FleetAttentionState {
  /** The project filter these sessions were read under; `null` is all. */
  scope: string | null;
  epoch: string | null;
  revision: number;
  sessions: ReadonlyMap<string, FleetAttentionSession>;
}

type Baseline = Pick<FleetAttentionSnapshot, "epoch" | "revision" | "sessions">;
type Changes = Extract<FleetAttentionFrame, { kind: "changes" }>;

export const emptyFleetAttention: FleetAttentionState = {
  scope: null,
  epoch: null,
  revision: 0,
  sessions: new Map(),
};

/** Newest-revision-wins merge of snapshots (stream or poll) and changes. */
export type FleetAttentionInput = (({ kind: "snapshot" } & Baseline) | Changes) & {
  scope: string | null;
};

export function applyFleetAttention(
  state: FleetAttentionState,
  input: FleetAttentionInput,
): FleetAttentionState {
  const sameScope = state.scope === input.scope;
  if (input.kind === "snapshot") {
    // A stale poll never rolls back a newer stream state in the same epoch.
    if (sameScope && state.epoch === input.epoch && input.revision < state.revision) return state;
    return {
      scope: input.scope,
      epoch: input.epoch,
      revision: input.revision,
      sessions: new Map(input.sessions.map((session) => [session.session_id, session])),
    };
  }
  if (!sameScope || state.epoch !== input.epoch || input.revision <= state.revision) return state;
  const sessions = new Map(state.sessions);
  for (const session of input.upserts) sessions.set(session.session_id, session);
  for (const id of input.removed) sessions.delete(id);
  return {
    scope: input.scope,
    epoch: input.epoch,
    revision: input.revision,
    sessions,
  };
}

type DecisionFacet = "permissions" | "questions" | "reviews";
const DECISION_FACETS: readonly DecisionFacet[] = ["permissions", "questions", "reviews"];

export interface AttentionCoverage {
  /** Exact current decisions; non-empty means the session needs you. */
  pending: FleetAttentionSession["pending"];
  /** Facets the server could not observe: never read these as "none pending". */
  unknown: DecisionFacet[];
  /** Facets this session's topology does not report at all. */
  unsupported: DecisionFacet[];
}

export function attentionCoverage(session: FleetAttentionSession): AttentionCoverage {
  const facets = (value: AttentionFacet) =>
    DECISION_FACETS.filter((facet) => session.availability[facet] === value);
  return {
    pending: session.pending,
    unknown: facets("unknown"),
    unsupported: facets("unsupported"),
  };
}

/** Sessions with pending decisions, grouped under their lineage root. */
export function pendingByRoot(
  sessions: ReadonlyMap<string, FleetAttentionSession>,
): Map<string, FleetAttentionSession[]> {
  const roots = new Map<string, FleetAttentionSession[]>();
  for (const session of sessions.values()) {
    if (session.pending.length === 0) continue;
    const root = session.lineage?.root_session_id ?? session.session_id;
    roots.set(root, [...(roots.get(root) ?? []), session]);
  }
  return roots;
}
