import { standalonePreferenceStorage } from "@/app/lib/store";
import { useSyncExternalStore } from "react";

// Shared across Insights / Files / Worksets / Subagents and every session — a
// viewing preference, not something that belongs to a particular chat.

const STORAGE_KEY = "nac-panel-list-width";

export const PANEL_LIST_MIN_WIDTH = 180;
/** Floor of the width a list takes before the user resizes it. */
export const PANEL_LIST_DEFAULT_WIDTH = 208;
export const PANEL_LIST_DEFAULT_RATIO = 1 / 3;
export const PANEL_LIST_MAX_RATIO = 0.75;

/** The list's share of a panel this wide until the user resizes it. */
export function defaultPanelListWidth(containerWidth: number): number {
  return Math.max(PANEL_LIST_DEFAULT_WIDTH, Math.round(containerWidth * PANEL_LIST_DEFAULT_RATIO));
}

export function createPanelWidth(storage?: Pick<Storage, "getItem" | "setItem">) {
  function readStoredWidth(): number | null {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      const parsed = raw == null ? NaN : Number(raw);
      if (!Number.isFinite(parsed)) return null;
      return Math.max(PANEL_LIST_MIN_WIDTH, Math.round(parsed));
    } catch {
      return null;
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

  function getSnapshot(): number | null {
    return width;
  }

  function getServerSnapshot(): number | null {
    return null;
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

  /**
   * Width the user gave the list column on the right of every side-box panel,
   * or null while it keeps its default share of the panel.
   */
  function usePanelListWidth(): number | null {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  }

  return {
    release: () => {
      width = null;
      listeners.forEach((listener) => listener());
    },
    clampPanelListWidth,
    setPanelListWidth,
    usePanelListWidth,
  };
}

export const { release, clampPanelListWidth, setPanelListWidth, usePanelListWidth } =
  createPanelWidth(standalonePreferenceStorage);
