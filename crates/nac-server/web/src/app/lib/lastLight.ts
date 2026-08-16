// The launch modal remembers the last light model a session was created
// with, so turning dual mode on again does not mean re-picking it.
// Presentation state only — the server never sees this key.

import type { JsonObject } from "@/app/lib/json";
import { isString } from "@/app/lib/primitive";
import type { LightModelSettings } from "@/app/types/api";

const STORAGE_KEY = "nac.last-light-model";

/** The last light model launched with, or null when there is none. */
export function loadLastLight(): LightModelSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (Object(parsed) !== parsed || Array.isArray(parsed)) return null;
    // SAFETY: the identity check above admits only non-null JSON objects, and
    // the field checks below verify the two fields the app reads.
    const light = parsed as JsonObject;
    if (!isString(light.model) || !isString(light.backend)) {
      return null;
    }
    // SAFETY: model and backend were just verified to be strings on the
    // object above, and the remaining optional fields are all string-or-null
    // in the stored shape; the assertion re-labels the still-unparsed value.
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
