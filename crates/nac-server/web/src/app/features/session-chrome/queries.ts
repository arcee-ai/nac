import { useQuery } from "@tanstack/react-query";

import { heartbeatKey } from "@/app/features/heartbeats/queries";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { HeartbeatSchedule } from "@/app/types/api";

/** States in which a schedule still has something to say. */
const LIVE_SCHEDULE_STATES = new Set<HeartbeatSchedule["state"]>(["active", "paused", "suspended"]);

/**
 * The session's interval schedules, read under the Schedules panel's own
 * inventory key so the Session menu and the panel share one cache entry. The
 * menu only needs to know whether any exist, so it refreshes at a gentle
 * cadence; the open panel keeps its own faster poll.
 */
export function useSessionSchedules(sessionId: string, enabled: boolean) {
  const { api } = useNativeRuntime();
  const inventory = useQuery({
    queryKey: heartbeatKey(sessionId),
    queryFn: ({ signal }) => api.heartbeatInventory(sessionId, signal),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
    retry: false,
  });
  // The cache entry is shared, so read it defensively rather than trust its shape.
  const schedules = Array.isArray(inventory.data) ? inventory.data : [];
  const live = schedules.filter((schedule) => LIVE_SCHEDULE_STATES.has(schedule.state));
  return {
    count: live.length,
    active: live.some((schedule) => schedule.state === "active"),
  };
}
