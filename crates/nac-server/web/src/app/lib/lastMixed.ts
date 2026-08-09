// The launch modal remembers the last mixed setup a session was created
// with, so turning mixed mode on again does not mean re-picking three
// models. Presentation state only — the server never sees this key.

import type { MixedModels, MixedTierSettings } from "@/app/types/api";

const STORAGE_KEY = "nac.last-mixed-models";

function isTier(value: unknown): value is MixedTierSettings {
  if (typeof value !== "object" || value === null) return false;
  const tier = value as Record<string, unknown>;
  return typeof tier.model === "string" && typeof tier.backend === "string";
}

/** The last mixed setup launched with, or null when there is none. */
export function loadLastMixed(): MixedModels | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const mixed = parsed as Record<string, unknown>;
    if (!isTier(mixed.easy) || !isTier(mixed.medium) || !isTier(mixed.hard)) {
      return null;
    }
    return {
      easy: mixed.easy,
      medium: mixed.medium,
      hard: mixed.hard,
    };
  } catch {
    return null;
  }
}

/** Called after a session is created; null records a single-model launch. */
export function storeLastMixed(mixed: MixedModels | null): void {
  try {
    if (mixed) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mixed));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode, quota); losing the
    // convenience default is fine.
  }
}
