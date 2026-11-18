import { expect, it } from "vitest";

import { catalogProviderForModel, contextShare, resolveCatalogModel } from "@/app/lib/catalog";
import type { CatalogProvider, ModelCatalog } from "@/app/types/api";

function openAiProvider(id: "openai-responses" | "openai-chat-completions"): CatalogProvider {
  return {
    id,
    auth: "api_key_env",
    auth_status: "ready",
    auth_hint: null,
    connection: { base_url: "https://api.openai.com/v1", api_key_env: "OPENAI_API_KEY" },
    default_base_url: "https://api.openai.com/v1",
    managed_base_url: null,
    default_limits: { context_window: 128_000, max_tokens: 16_384, supported_efforts: [] },
    models: [
      {
        id: "gpt-shared",
        display_name: "Shared OpenAI model",
        context_window: 128_000,
        max_tokens: 16_384,
        cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
        reasoning: false,
        supported_efforts: [],
        source: "baseline",
      },
    ],
  };
}

it("keeps model-only OpenAI inference on Responses when both protocols contain the id", () => {
  const catalog = {
    catalog_version: 1,
    providers: [openAiProvider("openai-chat-completions"), openAiProvider("openai-responses")],
  } as ModelCatalog;

  expect(catalogProviderForModel(catalog, "gpt-shared")).toBe("openai-responses");
});

it("uses the server's effective input budget and preserves its provenance", () => {
  const provider = openAiProvider("openai-responses");
  provider.models[0].limits = {
    context_window: 500_000,
    max_input_tokens: null,
    max_output_tokens: 16_384,
    effective_input_tokens: 475_000,
    automatic_compaction_threshold: 100_000,
    context_origin: "observed",
    input_origin: "profile",
    output_origin: "estimated",
  };
  const catalog: ModelCatalog = { catalog_version: 2, providers: [provider] };
  const model = resolveCatalogModel(catalog, provider.id, "gpt-shared");
  expect(model.contextWindow).toBe(475_000);
  expect(model.automaticThreshold).toBe(100_000);
  expect(contextShare(40_600, model)).toContain(
    "9% of the model's effective input budget (provider profile)",
  );
  provider.models[0].limits.input_origin = "estimated";
  expect(contextShare(40_600, resolveCatalogModel(catalog, provider.id, "gpt-shared"))).toContain(
    "estimated input budget",
  );
});
