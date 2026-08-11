// Reading the `GET /models` catalog the way the server reads it.
//
// The resolution order below mirrors `ModelCatalog::resolve` in
// crates/nac-core/src/model/catalog.rs: an exact entry, then a dated-snapshot
// family match, then the provider's `_default` limits. The last case is an
// estimate, and every caller is expected to say so rather than pass it off as
// catalog data.

import type {
  BackendKind,
  CatalogModel,
  CatalogProvider,
  ModelCatalog,
  ReasoningEffort,
} from "@/app/types/api";

/** What the catalog knows about the model a session is actually running. */
export interface ResolvedCatalogModel {
  provider: CatalogProvider | null;
  /** The catalog entry, absent when only the provider defaults matched. */
  model: CatalogModel | null;
  contextWindow: number | null;
  supportedEfforts: ReasoningEffort[];
  /** The numbers come from the provider default, not from a real entry. */
  estimated: boolean;
}

/** Where a session on this provider sends its requests. */
export function catalogBaseUrl(provider: CatalogProvider): string {
  return provider.managed_base_url ?? provider.default_base_url ?? "";
}

const EMPTY: ResolvedCatalogModel = {
  provider: null,
  model: null,
  contextWindow: null,
  supportedEfforts: [],
  estimated: false,
};

/** Strips a `-YYYYMMDD` snapshot suffix, as `dated_snapshot_family` does. */
function snapshotFamily(model: string): string | null {
  const cut = model.lastIndexOf("-");
  if (cut <= 0) return null;
  const suffix = model.slice(cut + 1);
  return suffix.length === 8 && /^\d{8}$/.test(suffix) ? model.slice(0, cut) : null;
}

function findProvider(
  catalog: ModelCatalog | undefined,
  backend: string,
): CatalogProvider | null {
  return catalog?.providers?.find((provider) => provider.id === backend) ?? null;
}

function findEntry(
  provider: CatalogProvider,
  model: string,
): CatalogModel | null {
  const exact = provider.models.find((entry) => entry.id === model);
  if (exact) return exact;
  const family = snapshotFamily(model);
  if (!family) return null;
  return provider.models.find((entry) => entry.id === family) ?? null;
}

/**
 * Resolves a (provider, model) pair against the catalog. An unknown model still
 * resolves — to the provider's defaults, flagged as an estimate — because the
 * server prices and limits it that way too.
 */
export function resolveCatalogModel(
  catalog: ModelCatalog | undefined,
  backend: string | null | undefined,
  model: string | null | undefined,
): ResolvedCatalogModel {
  const id = (model ?? "").trim();
  const provider = findProvider(catalog, (backend ?? "").trim());
  if (!provider || !id) return EMPTY;

  const entry = findEntry(provider, id);
  if (entry) {
    return {
      provider,
      model: entry,
      contextWindow: entry.context_window || null,
      supportedEfforts: entry.supported_efforts,
      estimated: false,
    };
  }
  return {
    provider,
    model: null,
    contextWindow: provider.default_limits.context_window || null,
    supportedEfforts: provider.default_limits.supported_efforts,
    estimated: true,
  };
}

/**
 * The provider carrying an entry for this model id, mirroring
 * `ModelCatalog::provider_for_model`: an exact match wins, and a collision
 * prefers the first provider that is not a managed login.
 */
export function catalogProviderForModel(
  catalog: ModelCatalog | undefined,
  model: string,
): BackendKind | null {
  const id = model.trim();
  if (!id) return null;
  const matches = (catalog?.providers ?? []).filter((provider) =>
    provider.models.some((entry) => entry.id === id),
  );
  if (matches.length === 0) return null;
  const unmanaged = matches.find((provider) => provider.managed_base_url === null);
  return (unmanaged ?? matches[0]).id;
}
