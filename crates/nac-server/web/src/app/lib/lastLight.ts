// The launch modal remembers the last light model a session was created
// with, so turning dual mode on again does not mean re-picking it.
// Presentation state only — the server never sees this key.

import type { LightModelSettings } from "@/app/types/api";

const STORAGE_KEY = "nac.last-light-model";

/** The last light model launched with, or null when there is none. */
export function loadLastLight(): LightModelSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const light = parsed as Record<string, unknown>;
    if (typeof light.model !== "string" || typeof light.backend !== "string") {
      return null;
    }
    return parsed as LightModelSettings;
  } catch {
    return null;
  }
}

/** Called after a session is created; null records a single-model launch. */
export function storeLastLight(light: LightModelSettings | null): void {
  try {
    if (light) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(light));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode, quota); losing the
    // convenience default is fine.
  }
}
