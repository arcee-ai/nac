// Fleet attention: one snapshot plus one shared stream for every session,
// instead of per-session permission/question polling. The server owns the
// classification; this module only keeps the newest revision and reports
// unknown/unsupported facets so the UI can say "status unavailable".
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer, useState } from "react";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { FLEET_ATTENTION_POLL_MS, queryKeys } from "@/app/services/queries/keys";
import type {
  AttentionFacet,
  FleetAttentionFrame,
  FleetAttentionSession,
  FleetAttentionSnapshot,
} from "@/app/types/api";

export type FleetAttentionStatus = "connecting" | "live" | "polling" | "unavailable";

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

export type FleetEventSourceFactory = (path: string) => Promise<EventSource> | EventSource;

export interface FleetAttentionOptions {
  projectId?: string;
  pollMs?: number;
  enabled?: boolean;
  /** Test/adapter seam; defaults to the runtime's authenticated stream. */
  eventSource?: FleetEventSourceFactory;
}

export interface FleetAttentionResult extends FleetAttentionState {
  status: FleetAttentionStatus;
}

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

export function useFleetAttention(options: FleetAttentionOptions = {}): FleetAttentionResult {
  const runtime = useNativeRuntime();
  const { api, client } = runtime;
  const projectId = options.projectId;
  const enabled = options.enabled ?? true;
  const [state, dispatch] = useReducer(applyFleetAttention, emptyFleetAttention);
  const streamPath = `/attention/stream${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`;
  // Keyed by path so a new filter starts as "connecting" without effect setState.
  const [streamState, setStreamState] = useState<{
    path: string;
    status: "connecting" | "live" | "down";
  }>({ path: streamPath, status: "connecting" });
  const stream = streamState.path === streamPath ? streamState.status : "connecting";

  const open = useMemo<FleetEventSourceFactory>(
    () =>
      options.eventSource ??
      runtime.openStream ??
      ((path) => new EventSource(client.transport.url(path), client.transport.eventSourceInit())),
    [options.eventSource, runtime.openStream, client],
  );

  // Polling is the baseline and the fallback; it pauses while the stream is live.
  const poll = useQuery<FleetAttentionSnapshot>({
    queryKey: queryKeys.fleetAttention(projectId ?? null),
    queryFn: ({ signal }) => api.fleetAttention(projectId, signal),
    enabled,
    refetchInterval: stream === "live" ? false : (options.pollMs ?? FLEET_ATTENTION_POLL_MS),
    staleTime: 0,
  });

  useEffect(() => {
    if (poll.data) dispatch({ kind: "snapshot", ...poll.data, scope: projectId ?? null });
  }, [poll.data, projectId]);

  useEffect(() => {
    if (!enabled) return;
    const path = streamPath;
    const setStream = (status: "live" | "down") => setStreamState({ path, status });
    let closed = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let delay = INITIAL_RETRY_MS;

    const reconnect = () => {
      source?.close();
      source = null;
      if (closed || retry !== null) return;
      setStream("down");
      retry = setTimeout(() => {
        retry = null;
        void connect();
      }, delay);
      delay = Math.min(delay * 2, MAX_RETRY_MS);
    };

    const connect = async () => {
      let opened: EventSource;
      try {
        opened = await open(path);
      } catch {
        reconnect();
        return;
      }
      if (closed) {
        opened.close();
        return;
      }
      source = opened;
      opened.addEventListener("fleet_attention", (event) => {
        if (closed || source !== opened || !(event instanceof MessageEvent)) return;
        let frame: FleetAttentionFrame;
        try {
          frame = JSON.parse(String(event.data)) as FleetAttentionFrame;
        } catch {
          reconnect();
          return;
        }
        if (frame.kind === "unavailable") {
          reconnect();
          return;
        }
        delay = INITIAL_RETRY_MS;
        dispatch({ ...frame, scope: projectId ?? null });
        setStream("live");
      });
      opened.onerror = () => {
        if (!closed && source === opened) reconnect();
      };
    };

    void connect();
    return () => {
      closed = true;
      if (retry !== null) clearTimeout(retry);
      source?.close();
      source = null;
    };
  }, [enabled, projectId, open, streamPath]);

  const status: FleetAttentionStatus =
    stream === "live"
      ? "live"
      : poll.isError
        ? "unavailable"
        : stream === "connecting" && !poll.data
          ? "connecting"
          : "polling";
  // Never present another filter's sessions as this one's.
  const current = state.scope === (projectId ?? null) ? state : emptyFleetAttention;
  return { ...current, status };
}
