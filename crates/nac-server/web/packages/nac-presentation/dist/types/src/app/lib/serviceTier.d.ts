import type { CatalogModel, ModelCatalog } from "../types/api";
/** Durable intent: null means inherit; Standard is an explicit override. */
export type ServiceTier = "standard" | "fast" | "ultrafast";
export interface DiscoveredTier {
    id: string;
    name: string;
    description: string;
}
export interface SpeedProfiles {
    [model: string]: {
        tiers: string[];
        fast_input_tokens_below?: number | null;
    };
}
export declare function providerSpeedProfiles(provider: unknown): SpeedProfiles | undefined;
/** Only authenticated, exact-model discovery can offer acceleration. */
export declare function discoveredSpeed(model: CatalogModel | null, modelId: string): DiscoveredTier[] | null;
/** Paid native API choices are confined to the canonical OpenAI route. */
export declare function isNativeOpenAiSpeedRoute(backend: string | null | undefined, baseUrl: string | null | undefined): boolean;
export declare function speedForRoute(model: CatalogModel | null, modelId: string, backend: string | null | undefined, baseUrl: string | null | undefined, profiles?: SpeedProfiles): {
    tiers: DiscoveredTier[] | null;
    openAiApi: boolean;
    fastContextLimit: number | null;
    explicitTiersAllowed: boolean;
};
export declare function speedForCatalogRoute(catalog: ModelCatalog | undefined, route: {
    backend: string;
    model: string;
    baseUrl?: string | null;
} | null): {
    tiers: DiscoveredTier[] | null;
    openAiApi: boolean;
    fastContextLimit: number | null;
    explicitTiersAllowed: boolean;
};
export declare function supportsSpeed(tiers: DiscoveredTier[] | null, speed: ServiceTier): boolean;
export declare function speedLabel(speed: ServiceTier | null | undefined): string;
