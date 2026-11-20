import { type CatalogPick } from "../../lib/catalog";
import type { ModelCatalog } from "../../types/api";
import type { ModelOverride } from "./modelChoice";
/** Construct an explicit choice for this session using the provider-owned credential. */
export declare function catalogOverride(catalog: ModelCatalog, pick: CatalogPick): ModelOverride;
export declare function useSuggestedModel(enabled: boolean): {
    override: ModelOverride | null;
    pending: boolean;
    noProviders: boolean;
    error: Error | null;
};
