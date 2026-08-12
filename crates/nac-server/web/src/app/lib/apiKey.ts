// How the launch and settings modals talk about an API key: a key is only ever
// checked by listing the models it reaches, so the same request that validates
// it also fills the model picker. Both modals report that one outcome the same
// way, which is why these live together rather than in either modal.

import type { SelectItem } from "@/app/atoms";
import { humanErrorText } from "@/app/lib/providerError";
import type { ProviderModel, ProviderModelList } from "@/app/types/api";

/** Long enough to stop firing on every keystroke of a pasted key. */
export const KEY_DEBOUNCE_MS = 600;

/** Stored keys never leave the server, so a saved setup only shows a stand-in. */
export const MASKED_KEY = "*".repeat(32);

/**
 * Marks the credential names this server generated for a configuration. A key
 * filed under one of these is nac's to manage; anything else names a variable
 * the operator set up themselves.
 */
const GENERATED_CREDENTIAL_PREFIX = "NAC_CONFIG_";

export function isGeneratedCredentialName(name: string): boolean {
  return name.startsWith(GENERATED_CREDENTIAL_PREFIX);
}

export type Validation =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "ready"; models: ProviderModel[]; baseUrl: string }
  | { status: "error"; message: string };

export function providerKeyValidation(
  active: boolean,
  query: { isFetching: boolean; error: unknown; data?: ProviderModelList },
  backend?: string | null,
): Validation {
  if (!active) return { status: "idle" };
  if (query.isFetching) return { status: "validating" };
  if (query.error)
    return { status: "error", message: humanErrorText(query.error, backend) };
  return query.data
    ? { status: "ready", models: query.data.models, baseUrl: query.data.base_url }
    : { status: "validating" };
}

export function modelItems(models: ProviderModel[]): SelectItem[] {
  return models.map((model) => ({
    id: model.id,
    label: model.display_name ?? model.id,
  }));
}
