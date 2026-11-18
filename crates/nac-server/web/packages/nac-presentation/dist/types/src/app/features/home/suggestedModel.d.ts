import { type CatalogPick } from "../../lib/catalog";
import type { ModelCatalog } from "../../types/api";
import type { ModelOverride } from "./modelChoice";
/** A catalog model as a per-session override, on the provider's own credential. */
export declare function catalogOverride(catalog: ModelCatalog, pick: CatalogPick): ModelOverride;
/**
 * TODO(backend): the server should own this default (remember the user's last
 * model, then prefer the connected Arcee account) so a session created without
 * a model never fails with "required setting 'backend' is missing".
 */
export declare function useSuggestedModel(enabled: boolean): {
    override: ModelOverride | null;
    pending: boolean;
    noProviders: boolean;
};
