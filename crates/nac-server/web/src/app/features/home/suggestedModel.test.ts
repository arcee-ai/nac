import { expect, it } from "vitest";
import type { ModelCatalog } from "@/app/types/api";
import { catalogOverride } from "./suggestedModel";

it("binds a connection's HTTP permission to its exact provider endpoint", () => {
  const catalog = {
    providers: [
      {
        id: "openai-responses",
        connection: {
          base_url: "http://127.0.0.1:4123/v1",
          allow_insecure_http: true,
          api_key_env: "NAC_PROVIDER_TEST",
        },
      },
    ],
  } as unknown as ModelCatalog;
  const pick = {
    backend: "openai-responses" as const,
    model: "example",
    baseUrl: "http://127.0.0.1:4123/v1",
  };
  expect(catalogOverride(catalog, pick).selection).toMatchObject({
    allow_insecure_http: true,
    api_key_env: "NAC_PROVIDER_TEST",
  });
  expect(
    catalogOverride(catalog, { ...pick, baseUrl: "http://other.invalid/v1" }).selection,
  ).toMatchObject({
    allow_insecure_http: false,
    api_key_env: null,
  });
});
