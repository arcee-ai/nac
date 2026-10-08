import type { BackendKind, CatalogModel, CatalogProvider, ModelCatalog, ReasoningEffort } from "../types/api";
/** A model chosen out of the catalog, together with where it is served. */
export interface CatalogPick {
    backend: BackendKind;
    model: string;
    /** The endpoint selected for its server-owned account, then catalog fallbacks. */
    baseUrl: string;
}
/** Where a session on this provider sends its requests. */
export declare function catalogBaseUrl(provider: CatalogProvider): string;
/**
 * What the catalog opens on while nothing has been picked, so a first session —
 * the case with no saved configuration to fall back on — is one click away. A
 * provider the server can already authenticate as wins; otherwise the stored
 * login one opens and asks for its login.
 */
export declare function defaultCatalogPick(catalog: ModelCatalog | undefined): CatalogPick | null;
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
/**
 * Resolves a (provider, model) pair against the catalog. An unknown model still
 * resolves — to the provider's defaults, flagged as an estimate — because the
 * server prices and limits it that way too.
 */
export declare function resolveCatalogModel(catalog: ModelCatalog | undefined, backend: string | null | undefined, model: string | null | undefined): ResolvedCatalogModel;
/**
 * The provider carrying an entry for this model id, mirroring
 * `ModelCatalog::provider_for_model`: an exact match wins, and a collision
 * prefers the first provider that is not a managed login.
 */
export declare function catalogProviderForModel(catalog: ModelCatalog | undefined, model: string): BackendKind | null;
