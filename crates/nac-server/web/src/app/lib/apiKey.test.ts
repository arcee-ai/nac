import { describe, expect, it } from "vitest";

import { providerKeyValidation, type Validation } from "@/app/lib/apiKey";
import type { ProviderModelList } from "@/app/types/api";

const data: ProviderModelList = {
  base_url: "https://api.example.test",
  models: [{ id: "model-1", display_name: "Model One" }],
};

describe("providerKeyValidation", () => {
  it.each<{
    name: string;
    active: boolean;
    query: Parameters<typeof providerKeyValidation>[1];
    backend?: string;
    expected: Validation;
  }>([
    {
      name: "is idle when validation is inactive",
      active: false,
      query: { isFetching: true, error: new Error("ignored"), data },
      expected: { status: "idle" },
    },
    {
      name: "reports an in-flight request before stale data or errors",
      active: true,
      query: { isFetching: true, error: new Error("ignored"), data },
      expected: { status: "validating" },
    },
    {
      name: "humanizes backend-specific provider errors",
      active: true,
      query: { isFetching: false, error: new Error("HTTP 401 Unauthorized") },
      backend: "codex",
      expected: {
        status: "error",
        message:
          "There was a problem with authentication. Please sign back in to continue using the API.",
      },
    },
    {
      name: "keeps the fallback provider message",
      active: true,
      query: { isFetching: false, error: new Error("Provider exploded") },
      backend: "openai",
      expected: { status: "error", message: "Provider exploded" },
    },
    {
      name: "returns models and base URL from a successful query",
      active: true,
      query: { isFetching: false, error: null, data },
      expected: {
        status: "ready",
        models: data.models,
        baseUrl: data.base_url,
      },
    },
    {
      name: "keeps waiting before a query has produced a result",
      active: true,
      query: { isFetching: false, error: null },
      expected: { status: "validating" },
    },
  ])("$name", ({ active, query, backend, expected }) => {
    expect(providerKeyValidation(active, query, backend)).toEqual(expected);
  });
});
