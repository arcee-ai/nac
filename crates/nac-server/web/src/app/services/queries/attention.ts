// Fleet attention: one snapshot plus one shared stream for every session,
// instead of per-session permission/question polling. The server owns the
// classification; this module only keeps the newest revision and reports
// unknown/unsupported facets so the UI can say "status unavailable".
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { FLEET_ATTENTION_POLL_MS, queryKeys } from "@/app/services/queries/keys";
import {
  applyFleetAttention,
  emptyFleetAttention,
  type FleetAttentionState,
} from "@/app/services/queries/fleetAttentionModel";
import type { FleetAttentionFrame, FleetAttentionSnapshot } from "@/app/types/api";

export * from "@/app/services/queries/fleetAttentionModel";

export type FleetAttentionStatus = "connecting" | "live" | "polling" | "unavailable";

export type FleetEventSourceFactory = (path: string) => Promise<EventSource> | EventSource;

export interface FleetAttentionOptions {
  projectId?: string;
  pollMs?: number;
  enabled?: boolean;
  /**
   * Hold the shared stream (default). False polls the snapshot only, for a
   * view whose own streams already use most of the browser's six HTTP/1.1
   * connections per origin.
   */
  stream?: boolean;
  /** Test/adapter seam; defaults to the runtime's authenticated stream. */
  eventSource?: FleetEventSourceFactory;
}

export interface FleetAttentionResult extends FleetAttentionState {
  status: FleetAttentionStatus;
}

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

interface PollSnapshot {
  snapshot: FleetAttentionSnapshot;
  startedAt: number;
}

export function useFleetAttention(options: FleetAttentionOptions = {}): FleetAttentionResult {
  const runtime = useNativeRuntime();
  const { api, client } = runtime;
  const projectId = options.projectId;
  const enabled = options.enabled ?? true;
  const streaming = enabled && (options.stream ?? true);
  const [state, dispatch] = useReducer(applyFleetAttention, emptyFleetAttention);
  const pollStarts = useRef(0);
  // Query data may outlive the request/effect that delivered it. Keep request
  // provenance with it so a delayed poll cannot replace a newer stream epoch.
  const streamBaseline = useRef({ scope: projectId ?? null, at: 0 });
  const [pollReceipt, setPollReceipt] = useState({ scope: projectId ?? null, version: 0 });
  const [outage, setOutage] = useState<{ scope: string | null; version: number } | null>(null);
  const streamPath = `/attention/stream${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`;
  // Keyed by path so a new filter starts as "connecting" without effect setState.
  const [streamState, setStreamState] = useState<{
    path: string;
    status: "connecting" | "live" | "down";
  }>({ path: streamPath, status: "connecting" });
  const stream = !streaming
    ? "down"
    : streamState.path === streamPath
      ? streamState.status
      : "connecting";

  const open = useMemo<FleetEventSourceFactory>(
    () =>
      options.eventSource ??
      runtime.openStream ??
      ((path) => new EventSource(client.transport.url(path), client.transport.eventSourceInit())),
    [options.eventSource, runtime.openStream, client],
  );

  // Polling is the baseline and the fallback; it pauses while the stream is live.
  const poll = useQuery<PollSnapshot>({
    queryKey: queryKeys.fleetAttention(projectId ?? null),
    queryFn: async ({ signal }) => {
      const version = ++pollStarts.current;
      const startedAt = performance.now();
      const snapshot = await api.fleetAttention(projectId, signal);
      if (!signal.aborted) setPollReceipt({ scope: projectId ?? null, version });
      return { snapshot, startedAt };
    },
    enabled,
    refetchInterval: stream === "live" ? false : (options.pollMs ?? FLEET_ATTENTION_POLL_MS),
    staleTime: 0,
  });

  const refetchPoll = poll.refetch;

  useEffect(() => {
    const baseline = streamBaseline.current;
    if (
      poll.data &&
      (baseline.scope !== (projectId ?? null) || poll.data.startedAt >= baseline.at)
    ) {
      dispatch({ kind: "snapshot", ...poll.data.snapshot, scope: projectId ?? null });
    }
  }, [poll.data, projectId]);

  useEffect(() => {
    if (!streaming) return;
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
          // Cached data and a poll begun before this failure cannot establish
          // current health. Only a fresh successful read or stream can do so.
          setOutage({ scope: projectId ?? null, version: pollStarts.current });
          reconnect();
          void refetchPoll();
          return;
        }
        delay = INITIAL_RETRY_MS;
        if (frame.kind === "snapshot") {
          streamBaseline.current = { scope: projectId ?? null, at: performance.now() };
        }
        dispatch({ ...frame, scope: projectId ?? null });
        setOutage(null);
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
  }, [streaming, projectId, open, streamPath, refetchPoll]);

  const unconfirmedOutage =
    outage?.scope === (projectId ?? null) &&
    (pollReceipt.scope !== outage.scope || pollReceipt.version <= outage.version);
  const status: FleetAttentionStatus =
    stream === "live"
      ? "live"
      : poll.isError || unconfirmedOutage
        ? "unavailable"
        : (stream === "connecting" || !streaming) && !poll.data
          ? "connecting"
          : "polling";
  // Never present another filter's sessions as this one's.
  const current = state.scope === (projectId ?? null) ? state : emptyFleetAttention;
  return { ...current, status };
}
