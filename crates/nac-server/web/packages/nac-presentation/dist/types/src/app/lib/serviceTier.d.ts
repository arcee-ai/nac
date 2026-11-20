import type { CatalogModel } from "../types/api";
/** Durable intent: null means inherit; Standard is an explicit override. */
export type ServiceTier = "standard" | "fast" | "ultrafast";
export interface DiscoveredTier {
    id: string;
    name: string;
    description: string;
}
/** Only authenticated, exact-model discovery can offer acceleration. */
export declare function discoveredSpeed(model: CatalogModel | null, modelId: string): DiscoveredTier[] | null;
export declare function supportsSpeed(tiers: DiscoveredTier[] | null, speed: ServiceTier): boolean;
export declare function speedLabel(speed: ServiceTier | null | undefined): string;
