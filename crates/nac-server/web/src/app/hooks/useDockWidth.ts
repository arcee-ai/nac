import { useSyncExternalStore } from "react";
import { standalonePreferenceStorage } from "@/app/lib/store";

const KEY = "nac-session-dock-width";
export const DOCK_MIN_WIDTH = 480;
export const DOCK_DEFAULT_WIDTH = 560;
export const CHAT_MIN_WIDTH = 460;

export function createDockWidth(storage?: Pick<Storage, "getItem" | "setItem">) {
  let width = DOCK_DEFAULT_WIDTH;
  try {
    const value = storage?.getItem(KEY);
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
      width = Math.max(DOCK_MIN_WIDTH, Math.round(Number(value)));
    }
  } catch {
    /* Storage can be unavailable. */
  }
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const setDockWidth = (next: number) => {
    if (!Number.isFinite(next)) return;
    width = Math.max(DOCK_MIN_WIDTH, Math.round(next));
    try {
      storage?.setItem(KEY, String(width));
    } catch {
      /* Keep the in-memory preference. */
    }
    listeners.forEach((listener) => listener());
  };
  return {
    useDockWidth: () =>
      useSyncExternalStore(
        subscribe,
        () => width,
        () => DOCK_DEFAULT_WIDTH,
      ),
    setDockWidth,
    release: () => {
      listeners.clear();
    },
  };
}
export const { useDockWidth, setDockWidth, release } = createDockWidth(standalonePreferenceStorage);
