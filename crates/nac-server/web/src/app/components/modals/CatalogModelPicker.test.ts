import { expect, it } from "vitest";

import { modelsForProvider } from "@/app/components/modals/catalogModelOverlay";
import type { CatalogProvider } from "@/app/types/api";

const seeded = {
  id: "arcee-api",
  auth: "api_key_env",
  auth_status: "ready",
  auth_hint: null,
  default_base_url: "https://api.arcee.ai/api/v1",
  managed_base_url: null,
  default_limits: { context_window: 128000, max_tokens: 4096, supported_efforts: [] },
  models: [
    {
      id: "trinity-large-thinking",
      display_name: "Trinity",
      context_window: 128000,
      max_tokens: 4096,
      cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      reasoning: true,
      supported_efforts: [],
      source: "baseline",
    },
  ],
} as CatalogProvider;

it("uses the seed only when live discovery is unavailable", () => {
  expect(modelsForProvider(seeded, undefined)).toEqual(seeded.models);
  expect(modelsForProvider(seeded, null)).toEqual([]);
  expect(modelsForProvider(seeded, [])).toEqual([]);
});
