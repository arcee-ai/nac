import { useSyncExternalStore } from "react";

// Shared across every session — height of the Threads command log as a
// fraction of the detail pane, not something that belongs to one chat.

const STORAGE_KEY = "nac-thread-log-height-ratio";

export const THREAD_LOG_MIN_RATIO = 0.2;
export const THREAD_LOG_MAX_RATIO = 0.8;
export const THREAD_LOG_DEFAULT_RATIO = 0.4;

function readStoredRatio(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(parsed)) return THREAD_LOG_DEFAULT_RATIO;
    return clampThreadLogRatio(parsed);
  } catch {
    return THREAD_LOG_DEFAULT_RATIO;
  }
}

let ratio = readStoredRatio();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  return ratio;
}

function getServerSnapshot(): number {
  return THREAD_LOG_DEFAULT_RATIO;
}

export function clampThreadLogRatio(next: number): number {
  return Math.min(
    THREAD_LOG_MAX_RATIO,
    Math.max(THREAD_LOG_MIN_RATIO, Math.round(next * 1000) / 1000),
  );
}

export function setThreadLogHeightRatio(next: number): void {
  const clamped = clampThreadLogRatio(next);
  if (clamped === ratio) return;
  ratio = clamped;
  try {
    localStorage.setItem(STORAGE_KEY, String(clamped));
  } catch {
    // Private mode / quota — keep the in-memory value either way.
  }
  listeners.forEach((listener) => listener());
}

/** Height of the Threads command log, as a fraction of the detail pane. */
export function useThreadLogHeightRatio(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
