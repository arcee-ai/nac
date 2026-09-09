/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LightModelSection, type LightSelection } from "./LightModelSection";
import type { ModelCatalog } from "@/app/types/api";

const catalog = {
  catalog_version: 1,
  providers: [
    {
      id: "arcee-api",
      auth: "api_key_env",
      auth_status: "ready",
      auth_hint: null,
      connection: {
        base_url: "https://api.arcee.ai/api/v1",
        api_key_env: "ARCEE_API_KEY",
      },
      default_base_url: "https://api.arcee.ai/api/v1",
      managed_base_url: null,
      default_limits: { context_window: 128000, max_tokens: 4096, supported_efforts: [] },
      models: [],
    },
    {
      id: "fireworks-chat",
      auth: "api_key_env",
      auth_status: "ready",
      auth_hint: null,
      connection: {
        base_url: "https://saved.example/v1",
        api_key_env: "NAC_CONFIG_saved_fireworks",
      },
      default_base_url: "https://api.fireworks.ai/inference/v1",
      managed_base_url: null,
      default_limits: { context_window: 128000, max_tokens: 4096, supported_efforts: [] },
      models: [],
    },
  ],
} as ModelCatalog;

vi.mock("@/app/services/queries", () => ({
  useModelCatalog: () => ({ data: catalog, isLoading: false, isError: false }),
  useReadyProviderModels: () => new Map(),
}));

vi.mock("@/app/components/modals/CatalogModelPicker", () => ({
  CatalogModelPicker: ({
    onSelect,
  }: {
    onSelect: (pick: { backend: string; model: string; baseUrl: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({
          backend: "fireworks-chat",
          model: "accounts/fireworks/models/llama-v3p1-8b-instruct",
          baseUrl: "https://saved.example/v1",
        })
      }
    >
      Choose saved Fireworks light model
    </button>
  ),
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("carries the selected provider account selector in a cross-provider light route", async () => {
  const onChange = vi.fn<(selection: LightSelection) => void>();
  render(
    <LightModelSection
      initial={{
        backend: "arcee-api",
        model: "trinity-large-thinking",
        base_url: "https://api.arcee.ai/api/v1",
        api_key_env: "ARCEE_API_KEY",
        reasoning_effort: null,
      }}
      onChange={onChange}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Choose saved Fireworks light model" }));

  await waitFor(() =>
    expect(onChange).toHaveBeenLastCalledWith({
      mode: "dual",
      light: {
        backend: "fireworks-chat",
        model: "accounts/fireworks/models/llama-v3p1-8b-instruct",
        base_url: "https://saved.example/v1",
        api_key_env: "NAC_CONFIG_saved_fireworks",
        reasoning_effort: null,
      },
    }),
  );
});
