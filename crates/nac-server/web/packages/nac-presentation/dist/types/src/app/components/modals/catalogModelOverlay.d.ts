import type { CatalogModel, CatalogProvider, ProviderModel } from "../../types/api";
/** Live discovery only returns id + display name; fill limits from the catalog. */
export declare function modelsForProvider(provider: CatalogProvider, live: ProviderModel[] | null | undefined): CatalogModel[];
