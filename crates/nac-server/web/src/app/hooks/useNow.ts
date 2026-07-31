import { useCallback, useSyncExternalStore } from "react";

import { readClock, subscribeToClock } from "@/app/lib/clock";

const noop = () => () => {};
const zero = () => 0;

/**
 * Current wall-clock time, refreshed every `intervalMs`. Pick the coarsest
 * resolution that still looks right: one second for run timers, a minute for
 * relative-time filters. Pass `enabled: false` to stop ticking entirely, which
 * keeps idle session cards from re-rendering every second.
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const subscribe = useCallback(
    (listener: () => void) =>
      enabled ? subscribeToClock(intervalMs, listener) : noop(),
    [intervalMs, enabled],
  );
  const snapshot = useCallback(
    () => (enabled ? readClock(intervalMs) : 0),
    [intervalMs, enabled],
  );
  return useSyncExternalStore(subscribe, snapshot, enabled ? snapshot : zero);
}
