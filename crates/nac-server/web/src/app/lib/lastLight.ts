import { standalonePreferenceStorage } from "@/app/lib/store";
// The launch modal remembers the last light model a session was created
// with, so turning dual mode on again does not mean re-picking it.
// Presentation state only — the server never sees this key.

import type { JsonObject } from "@/app/lib/json";
import { isString } from "@/app/lib/primitive";
import type { LightModelSettings } from "@/app/types/api";

const STORAGE_KEY = "nac.last-light-model";

export function createLastLight(storage?: Pick<Storage, "getItem" | "setItem">) {
  /** The last light model launched with, or null when there is none. */
  let lastLight: LightModelSettings | null = null;
  function loadLastLight(): LightModelSettings | null {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (!raw) return lastLight;
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
  function storeLastLight(light: LightModelSettings | null): void {
    lastLight = light;
    try {
      if (light) {
        storage?.setItem(STORAGE_KEY, JSON.stringify(light));
      } else {
        storage?.setItem(STORAGE_KEY, "");
      }
    } catch {
      // Storage can be unavailable (private mode, quota); losing the
      // convenience default is fine.
    }
  }

  return {
    release: () => {
      lastLight = null;
    },
    loadLastLight,
    storeLastLight,
  };
}

export const { release, loadLastLight, storeLastLight } = createLastLight(
  standalonePreferenceStorage,
);
