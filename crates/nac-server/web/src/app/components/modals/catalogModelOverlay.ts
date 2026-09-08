import type { CatalogModel, CatalogProvider, ModelCostRates, ProviderModel } from "@/app/types/api";

const EMPTY_COST: ModelCostRates = {
  input: 0,
  output: 0,
  cache_read: 0,
  cache_write: 0,
};

/** Live discovery only returns id + display name; fill limits from the catalog. */
export function modelsForProvider(
  provider: CatalogProvider,
  live: ProviderModel[] | null | undefined,
): CatalogModel[] {
  // Undefined means discovery was unavailable and the embedded seed is the
  // only information we have. Pending and successful-empty results expose no
  // seeded models: neither is evidence of an organization entitlement.
  if (live === undefined) return provider.models;
  if (live === null) return [];
  const known = new Map(provider.models.map((model) => [model.id, model]));
  return live.map((entry) => {
    const catalog = known.get(entry.id);
    if (catalog) {
      return entry.display_name && entry.display_name !== catalog.display_name
        ? { ...catalog, display_name: entry.display_name }
        : catalog;
    }
    return {
      id: entry.id,
      display_name: entry.display_name,
      context_window: provider.default_limits.context_window,
      max_tokens: provider.default_limits.max_tokens,
      cost: EMPTY_COST,
      reasoning: false,
      supported_efforts: provider.default_limits.supported_efforts,
      source: "fallback",
    };
  });
}
