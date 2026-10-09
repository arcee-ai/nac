import { standalonePreferenceStorage } from "@/app/lib/store";
import { useSyncExternalStore } from "react";

// Shared across Files / Worksets / Threads and every session — a viewing
// preference, not something that belongs to a particular chat.

const STORAGE_KEY = "nac-panel-list-width";

export const PANEL_LIST_MIN_WIDTH = 180;
export const PANEL_LIST_DEFAULT_WIDTH = 208;
export const PANEL_LIST_MAX_RATIO = 0.75;

export function createPanelWidth(storage?: Pick<Storage, "getItem" | "setItem">) {
  function readStoredWidth(): number {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      const parsed = raw == null ? NaN : Number(raw);
      if (!Number.isFinite(parsed)) return PANEL_LIST_DEFAULT_WIDTH;
      return Math.max(PANEL_LIST_MIN_WIDTH, Math.round(parsed));
    } catch {
      return PANEL_LIST_DEFAULT_WIDTH;
    }
  }

  let width = readStoredWidth();
  const listeners = new Set<() => void>();

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot(): number {
    return width;
  }

  function getServerSnapshot(): number {
    return PANEL_LIST_DEFAULT_WIDTH;
  }

  /** Clamp to the hard floor; the caller supplies the container-relative ceiling. */
  function clampPanelListWidth(next: number, maxWidth: number): number {
    return Math.min(
      Math.max(PANEL_LIST_MIN_WIDTH, Math.round(next)),
      Math.max(PANEL_LIST_MIN_WIDTH, Math.round(maxWidth)),
    );
  }

  function setPanelListWidth(next: number): void {
    const clamped = Math.max(PANEL_LIST_MIN_WIDTH, Math.round(next));
    if (clamped === width) return;
    width = clamped;
    try {
      storage?.setItem(STORAGE_KEY, String(clamped));
    } catch {
      // Private mode / quota — keep the in-memory value either way.
    }
    listeners.forEach((listener) => listener());
  }

  /** Width of the left list column inside every side-box panel. */
  function usePanelListWidth(): number {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  }

  return {
    release: () => {
      width = PANEL_LIST_DEFAULT_WIDTH;
      listeners.forEach((listener) => listener());
    },
    clampPanelListWidth,
    setPanelListWidth,
    usePanelListWidth,
  };
}

export const { release, clampPanelListWidth, setPanelListWidth, usePanelListWidth } =
  createPanelWidth(standalonePreferenceStorage);
