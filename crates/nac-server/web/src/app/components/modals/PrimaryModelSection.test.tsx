/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PrimaryModelSection } from "./PrimaryModelSection";
import { queryKeys } from "@/app/services/queries/keys";
import { api } from "@/app/services/api";
import type { LaunchModelSelection } from "./ConfigurationsPanel";
import type {
  ManagedHostStatus,
  ModelCatalog,
  ModelConfigurationList,
  ResolvedModelConfiguration,
} from "@/app/types/api";

const host = {
  model_ready: true,
  model: {
    backend: "arcee-api",
    id: "entitled",
    endpoint: "https://api.arcee.ai/api/v1",
    display_name: "Mounted provider",
  },
} as ManagedHostStatus;
const catalog = {
  catalog_version: 1,
  providers: [
    {
      id: "arcee-api",
      auth: "api_key_env",
      auth_status: "ready",
      auth_hint: null,
      connection: { base_url: host.model.endpoint, api_key_env: null },
      default_base_url: host.model.endpoint,
      managed_base_url: null,
      models: [
        {
          id: "entitled",
          display_name: "Entitled",
          context_window: 128000,
          max_tokens: 4096,
          cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
          reasoning: false,
          supported_efforts: [],
          source: "baseline",
        },
      ],
      default_limits: { supported_efforts: [], context_window: 128000, max_tokens: 4096 },
    },
  ],
} as ModelCatalog;
function mount(
  initial?: Parameters<typeof PrimaryModelSection>[0]["initial"],
  inheritSavedDefault = false,
  existingSession = false,
) {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn<(value: LaunchModelSelection | null) => void>();
  const view = render(
    <QueryClientProvider client={client}>
      <PrimaryModelSection
        initial={initial}
        inheritSavedDefault={inheritSavedDefault}
        existingSession={existingSession}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  return { client, view, onChange };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("waits for the latest saved default to resolve and reproduces its full tuple", async () => {
  const saved = Promise.withResolvers<ModelConfigurationList>();
  const resolved = Promise.withResolvers<ResolvedModelConfiguration>();
  vi.spyOn(api, "getManagedStatus").mockResolvedValue(host);
  vi.spyOn(api, "getModelCatalog").mockResolvedValue(catalog);
  vi.spyOn(api, "listProviderModels").mockResolvedValue({
    base_url: host.model.endpoint,
    models: [{ id: "entitled", display_name: "Entitled" }],
  });
  vi.spyOn(api, "listModelConfigs").mockReturnValue(saved.promise);
  vi.spyOn(api, "resolveModelConfig").mockReturnValue(resolved.promise);
  const { view, client, onChange } = mount(undefined, true);
  try {
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
    const record = {
      config_id: "exact-preset",
      name: "Exact preset",
      backend: "openai-responses" as const,
      model: "saved-model",
      base_url: "https://gateway.example/v1",
      api_key_env: "SECOND_ACCOUNT",
      allow_insecure_http: false,
      reasoning_effort: "high" as const,
      extra_headers: { "X-Account": "second" },
      orchestrator_compaction_threshold: null,
      light_model: { model: "hidden-light" },
      created_at: "2026-09-30",
      updated_at: "2026-09-30",
    };
    await act(async () => {
      saved.resolve({ configurations: [record] });
    });
    expect(onChange.mock.calls.every(([value]) => value === null)).toBe(true);
    await act(async () => {
      resolved.resolve({
        ...record,
        models: [{ id: "saved-model", display_name: "Saved" }],
        models_error: null,
      });
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          kind: "resolved",
          config_id: "exact-preset",
          api_key_env: "SECOND_ACCOUNT",
          extra_headers: { "X-Account": "second" },
          reasoning_effort: "high",
          orchestrator_compaction_threshold: null,
          light_model: { model: "hidden-light" },
        }),
      ),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it("waits for mounted-provider entitlements and treats an empty result as authoritative", async () => {
  const discovery = Promise.withResolvers<Awaited<ReturnType<typeof api.listProviderModels>>>();
  vi.spyOn(api, "getManagedStatus").mockResolvedValue(host);
  vi.spyOn(api, "getModelCatalog").mockResolvedValue(catalog);
  const models = vi.spyOn(api, "listProviderModels").mockReturnValue(discovery.promise);
  const { view, client, onChange } = mount();
  try {
    await waitFor(() => expect(models).toHaveBeenCalled());
    expect(onChange.mock.calls.every(([value]) => value === null)).toBe(true);
    await act(async () => {
      discovery.resolve({ base_url: host.model.endpoint, models: [] });
    });
    expect(onChange.mock.calls.every(([value]) => value === null)).toBe(true);
    expect(models).toHaveBeenCalledWith(
      { backend: "arcee-api", base_url: host.model.endpoint },
      expect.any(AbortSignal),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it.each(["chatgpt-codex-responses", "arcee-auth"] as const)(
  "retains an existing %s route while signed out without enabling a new provider pick",
  async (backend) => {
    vi.spyOn(api, "getManagedStatus").mockResolvedValue({ ...host, model_ready: false });
    vi.spyOn(api, "getModelCatalog").mockResolvedValue({
      ...catalog,
      providers: [
        { ...catalog.providers[0], id: backend, auth_status: "no_credential", connection: null },
      ],
    });
    const initial = {
      backend,
      model: "saved-oauth-model",
      base_url: "https://saved.example/v1",
      api_key_env: null,
      reasoning_effort: null,
      extra_headers: {},
      light_model: null,
      orchestrator_compaction_threshold: null,
    };
    const { view, client, onChange } = mount(initial, false, true);
    try {
      await waitFor(() =>
        expect(onChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ kind: "resolved", ...initial }),
        ),
      );
    } finally {
      view.unmount();
      client.clear();
    }
  },
);

it.each(["chatgpt-codex-responses", "arcee-auth"] as const)(
  "still gates a new %s launch from a saved route while signed out",
  async (backend) => {
    vi.spyOn(api, "getManagedStatus").mockResolvedValue({ ...host, model_ready: false });
    vi.spyOn(api, "getModelCatalog").mockResolvedValue({
      ...catalog,
      providers: [
        { ...catalog.providers[0], id: backend, auth_status: "no_credential", connection: null },
      ],
    });
    const { view, client, onChange } = mount({
      backend,
      model: "saved-oauth-model",
      base_url: "https://saved.example/v1",
      api_key_env: null,
      reasoning_effort: null,
      extra_headers: {},
    });
    try {
      await waitFor(() =>
        expect(client.getQueryState(queryKeys.modelCatalog)?.status).toBe("success"),
      );
      expect(onChange.mock.calls.every(([selection]) => selection === null)).toBe(true);
    } finally {
      view.unmount();
      client.clear();
    }
  },
);
