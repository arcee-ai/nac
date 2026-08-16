// Shared ticking clock.
//
// Reading `Date.now()` during render is impure and makes a component's output
// depend on when React happens to re-run it. Instead the current time is kept
// in an external store that ticks on an interval, so render only reads a value.

interface Clock {
  now: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
}

const clocks = new Map<number, Clock>();

function getClock(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = { now: Date.now(), listeners: new Set(), timer: null };
    clocks.set(intervalMs, clock);
  }
  return clock;
}

export function subscribeToClock(intervalMs: number, listener: () => void): () => void {
  const clock = getClock(intervalMs);
  clock.listeners.add(listener);
  // The interval only runs while something is watching this resolution.
  clock.timer ??= setInterval(() => {
    clock.now = Date.now();
    clock.listeners.forEach((l) => l());
  }, intervalMs);

  return () => {
    clock.listeners.delete(listener);
    if (clock.listeners.size === 0 && clock.timer) {
      clearInterval(clock.timer);
      clock.timer = null;
    }
  };
}

export function readClock(intervalMs: number): number {
  return getClock(intervalMs).now;
}
