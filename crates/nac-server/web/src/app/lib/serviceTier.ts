import type { CatalogModel } from "@/app/types/api";

/** Durable intent: null means inherit; Standard is an explicit override. */
export type ServiceTier = "standard" | "fast" | "ultrafast";
export interface DiscoveredTier {
  id: string;
  name: string;
  description: string;
}
export interface SpeedProfiles {
  [model: string]: { tiers: string[]; fast_input_tokens_below?: number | null };
}

export function providerSpeedProfiles(provider: unknown): SpeedProfiles | undefined {
  return (provider as { speed_profiles?: SpeedProfiles } | null | undefined)?.speed_profiles;
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

/** Paid native API choices are confined to the canonical OpenAI route. */
export function isNativeOpenAiSpeedRoute(
  backend: string | null | undefined,
  baseUrl: string | null | undefined,
): boolean {
  return (
    (backend === "openai-responses" || backend === "openai-chat-completions") &&
    baseUrl?.replace(/\/+$/, "") === "https://api.openai.com/v1"
  );
}

export function speedForRoute(
  model: CatalogModel | null,
  modelId: string,
  backend: string | null | undefined,
  baseUrl: string | null | undefined,
  profiles?: SpeedProfiles,
) {
  const openAiApi = isNativeOpenAiSpeedRoute(backend, baseUrl);
  const profile =
    openAiApi && profiles && Object.hasOwn(profiles, modelId) ? profiles[modelId] : undefined;
  const tiers =
    backend === "chatgpt-codex-responses"
      ? discoveredSpeed(model, modelId)
      : profile
        ? profile.tiers.flatMap((tier) =>
            tier === "fast"
              ? [{ id: "priority", name: "Fast", description: "Fast" }]
              : tier === "ultrafast"
                ? [{ id: "ultrafast", name: "Ultrafast", description: "Ultrafast" }]
                : [],
          )
        : null;
  const fastContextLimit = profile?.fast_input_tokens_below ?? null;
  return { tiers, openAiApi, fastContextLimit };
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
