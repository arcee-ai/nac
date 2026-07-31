import { useCallback, useSyncExternalStore } from "react";

import { readClock, subscribeToClock } from "@/app/lib/clock";

/**
 * Current wall-clock time, refreshed every `intervalMs`. Pick the coarsest
 * resolution that still looks right: one second for run timers, a minute for
 * relative-time filters.
 */
export function useNow(intervalMs = 1000): number {
  const subscribe = useCallback(
    (listener: () => void) => subscribeToClock(intervalMs, listener),
    [intervalMs],
  );
  const snapshot = useCallback(() => readClock(intervalMs), [intervalMs]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
