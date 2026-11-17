// Fleet attention: one snapshot plus one shared stream for every session,
// instead of per-session permission/question polling. The server owns the
// classification; this module only keeps the newest revision and reports
// unknown/unsupported facets so the UI can say "status unavailable".
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer, useState } from "react";

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
