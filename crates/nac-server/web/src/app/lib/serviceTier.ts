import type { CatalogModel } from "@/app/types/api";

/** Durable intent: null means inherit; Standard is an explicit override. */
export type ServiceTier = "standard" | "fast" | "ultrafast";
export interface DiscoveredTier {
  id: string;
  name: string;
  description: string;
}

/** Only authenticated, exact-model discovery can offer acceleration. */
export function discoveredSpeed(
  model: CatalogModel | null,
  modelId: string,
): DiscoveredTier[] | null {
  if (model?.id !== modelId) return null;
  const tiers = (model as (CatalogModel & { service_tiers?: DiscoveredTier[] | null }) | null)
    ?.service_tiers;
  return tiers ?? null;
}

export function supportsSpeed(tiers: DiscoveredTier[] | null, speed: ServiceTier): boolean {
  return (
    speed === "standard" ||
    Boolean(tiers?.some((tier) => tier.id === (speed === "fast" ? "priority" : "ultrafast")))
  );
}

export function speedLabel(speed: ServiceTier | null | undefined): string {
  return speed ? speed[0].toUpperCase() + speed.slice(1) : "Provider default";
}
