import { modelsForProvider } from "@/app/components/modals/catalogModelOverlay";
import { catalogBaseUrl, defaultCatalogPick, type CatalogPick } from "@/app/lib/catalog";
import { providerOrder } from "@/app/lib/providers";
import { useModelCatalog, useReadyProviderModels } from "@/app/services/queries";
import type { BackendKind, ModelCatalog, ProviderModel } from "@/app/types/api";

import type { ModelOverride } from "./modelChoice";

type LiveModels = Map<BackendKind, ProviderModel[] | null>;

/**
 * The model a session uses when nothing was picked and nothing is inherited:
 * Arcee's default when that account is connected, else the first model of any
 * connected provider. Pending while a live index is still loading, so the
 * choice does not flicker from one provider to another.
 */
function suggestedPick(
  catalog: ModelCatalog,
  live: LiveModels,
): { pick: CatalogPick | null; pending: boolean } {
  const ready = catalog.providers.filter((provider) => provider.auth_status === "ready");
  const arcee = defaultCatalogPick(catalog);
  const arceeProvider = ready.find((provider) => provider.id === arcee?.backend);
  if (arcee && arceeProvider) {
    const index = live.get(arceeProvider.id);
    if (index === null) return { pick: null, pending: true };
    const ids = modelsForProvider(arceeProvider, index).map((model) => model.id);
    const model = ids.includes(arcee.model) ? arcee.model : ids[0];
    if (model) return { pick: { ...arcee, model }, pending: false };
  }
  for (const provider of [...ready].sort((a, b) => providerOrder(a.id) - providerOrder(b.id))) {
    const index = live.get(provider.id);
    if (index === null) return { pick: null, pending: true };
    const first = modelsForProvider(provider, index)[0];
    const baseUrl = catalogBaseUrl(provider);
    if (first && baseUrl) {
      return { pick: { backend: provider.id, model: first.id, baseUrl }, pending: false };
    }
  }
  return { pick: null, pending: false };
}

/** Construct an explicit choice for this session using the provider-owned credential. */
export function catalogOverride(catalog: ModelCatalog, pick: CatalogPick): ModelOverride {
  const provider = catalog.providers.find((entry) => entry.id === pick.backend);
  return {
    selection: {
      kind: "resolved",
      backend: pick.backend,
      model: pick.model,
      base_url: pick.baseUrl,
      allow_insecure_http:
        provider?.connection?.base_url === pick.baseUrl
          ? provider.connection.allow_insecure_http
          : false,
      api_key_env:
        provider?.connection?.base_url === pick.baseUrl
          ? (provider.connection.api_key_env ?? null)
          : null,
      reasoning_effort: null,
      extra_headers: null,
    },
  };
}

export function useSuggestedModel(enabled: boolean): {
  override: ModelOverride | null;
  pending: boolean;
  noProviders: boolean;
  error: Error | null;
} {
  const catalog = useModelCatalog(enabled);
  const live = useReadyProviderModels(enabled ? catalog.data : undefined);
  if (!enabled || !catalog.data) {
    return {
      override: null,
      pending: enabled && catalog.isPending,
      noProviders: false,
      error: enabled ? catalog.error : null,
    };
  }
  const { pick, pending } = suggestedPick(catalog.data, live);
  const override = pick ? catalogOverride(catalog.data, pick) : null;
  return { override, pending, noProviders: !pick && !pending, error: null };
}
