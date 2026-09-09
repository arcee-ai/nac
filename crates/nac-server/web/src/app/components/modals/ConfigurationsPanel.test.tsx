/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  ConfigurationsPanel,
  type LaunchModelSelection,
} from "@/app/components/modals/ConfigurationsPanel";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import type {
  ManagedHostStatus,
  ModelCatalog,
  ModelConfigurationList,
  ResolvedModelConfiguration,
} from "@/app/types/api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

const hostStatus = {
  model_ready: true,
  model: {
    backend: "arcee-api",
    id: "trinity-large-thinking",
    endpoint: "https://api.arcee.ai/api/v1",
    display_name: "Managed Arcee",
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
    },
  ],
} as ModelCatalog;

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

it("treats a successful empty entitlement index as authoritative for rows and defaults", async () => {
  vi.spyOn(api, "getManagedStatus").mockResolvedValue(hostStatus);
  vi.spyOn(api, "listModelConfigs").mockResolvedValue({ configurations: [] });
  vi.spyOn(api, "getModelCatalog").mockResolvedValue(catalog);
  vi.spyOn(api, "listProviderModels").mockResolvedValue({
    base_url: hostStatus.model.endpoint,
    models: [],
  });
  const onChange = vi.fn<(selection: LaunchModelSelection | null) => void>();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfigurationsPanel invalid={false} onChange={onChange} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  try {
    await waitFor(() =>
      expect(
        client.getQueryData(["managed-provider-models", "arcee-api", hostStatus.model.endpoint]),
      ).toEqual({ base_url: hostStatus.model.endpoint, models: [] }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Select a model/ })).toBeTruthy(),
    );
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.every(([selection]) => selection === null)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Select a model/ }));
    expect(screen.queryByText("Trinity")).toBeNull();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("uses the configured managed default only when live discovery is unavailable", async () => {
  vi.spyOn(api, "getManagedStatus").mockResolvedValue(hostStatus);
  vi.spyOn(api, "listModelConfigs").mockResolvedValue({ configurations: [] });
  vi.spyOn(api, "getModelCatalog").mockResolvedValue(catalog);
  vi.spyOn(api, "listProviderModels").mockRejectedValue(new Error("offline"));
  const onChange = vi.fn<(selection: LaunchModelSelection | null) => void>();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfigurationsPanel invalid={false} onChange={onChange} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  try {
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          kind: "resolved",
          backend: "arcee-api",
          model: hostStatus.model.id,
        }),
      ),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it("never emits a managed default between status, catalog, and entitlement hydration", async () => {
  const host = deferred<ManagedHostStatus>();
  const catalogRequest = deferred<ModelCatalog>();
  const entitlement = deferred<{
    base_url: string;
    models: Array<{ id: string; display_name: string | null }>;
  }>();
  vi.spyOn(api, "getManagedStatus").mockReturnValue(host.promise);
  vi.spyOn(api, "listModelConfigs").mockResolvedValue({ configurations: [] });
  vi.spyOn(api, "getModelCatalog").mockReturnValue(catalogRequest.promise);
  const discovery = vi.spyOn(api, "listProviderModels").mockReturnValue(entitlement.promise);
  const onChange = vi.fn<(selection: LaunchModelSelection | null) => void>();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfigurationsPanel invalid={false} onChange={onChange} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  const onlyNullSelections = () =>
    onChange.mock.calls.length > 0 &&
    onChange.mock.calls.every(([selection]) => selection === null);
  try {
    host.resolve(hostStatus);
    await waitFor(() => expect(client.getQueryData(["managed-host-status"])).toEqual(hostStatus));
    expect(onlyNullSelections()).toBe(true);
    expect(discovery).not.toHaveBeenCalled();

    catalogRequest.resolve(catalog);
    await waitFor(() => expect(discovery).toHaveBeenCalledOnce());
    expect(onlyNullSelections()).toBe(true);

    entitlement.resolve({
      base_url: hostStatus.model.endpoint,
      models: [{ id: hostStatus.model.id, display_name: "Trinity" }],
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          kind: "resolved",
          backend: "arcee-api",
          model: hostStatus.model.id,
        }),
      ),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("waits for persisted configurations and managed status before emitting an implicit default", async () => {
  const host = deferred<ManagedHostStatus>();
  const configs = deferred<ModelConfigurationList>();
  vi.spyOn(api, "getManagedStatus").mockReturnValue(host.promise);
  vi.spyOn(api, "listModelConfigs").mockReturnValue(configs.promise);
  vi.spyOn(api, "getModelCatalog").mockResolvedValue(catalog);
  vi.spyOn(api, "resolveModelConfig").mockResolvedValue({
    backend: "openai-responses",
    model: "gpt-5.6-sol",
    base_url: "https://api.openai.com/v1",
    api_key_env: "SAVED_API_KEY",
    reasoning_effort: "high",
    models: [{ id: "gpt-5.6-sol", display_name: "GPT-5.6 Sol" }],
    models_error: null,
  } satisfies ResolvedModelConfiguration);
  const onChange = vi.fn<(selection: LaunchModelSelection | null) => void>();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfigurationsPanel invalid={false} onChange={onChange} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.every(([selection]) => selection === null)).toBe(true);

    host.resolve(hostStatus);
    await waitFor(() => expect(client.getQueryData(["managed-host-status"])).toEqual(hostStatus));
    expect(onChange.mock.calls.every(([selection]) => selection === null)).toBe(true);

    configs.resolve({
      configurations: [
        {
          config_id: "saved-config",
          name: "Saved provider",
          backend: "openai-responses",
          model: "gpt-5.6-sol",
          base_url: "https://api.openai.com/v1",
          api_key_env: "SAVED_API_KEY",
          reasoning_effort: "high",
          extra_headers: {},
          light_model: null,
          created_at: "2026-09-08T00:00:00Z",
          updated_at: "2026-09-08T00:00:00Z",
        },
      ],
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          kind: "resolved",
          backend: "openai-responses",
          model: "gpt-5.6-sol",
          config_id: "saved-config",
        }),
      ),
    );
    expect(
      onChange.mock.calls.some(
        ([selection]) => selection?.kind === "resolved" && selection.model === hostStatus.model.id,
      ),
    ).toBe(false);
  } finally {
    view.unmount();
    client.clear();
  }
});

it("preserves exact inherited advanced settings when duplicate presets share basic identity", async () => {
  vi.spyOn(api, "getManagedStatus").mockResolvedValue(hostStatus);
  vi.spyOn(api, "getModelCatalog").mockResolvedValue(catalog);
  vi.spyOn(api, "listModelConfigs").mockResolvedValue({
    configurations: ["first", "second"].map((suffix, index) => ({
      config_id: `saved-config-${suffix}`,
      name: `Saved provider ${suffix}`,
      backend: "openai-responses" as const,
      model: "gpt-5.6-sol",
      base_url: "https://api.openai.com/v1",
      api_key_env: "SAVED_API_KEY",
      reasoning_effort: (index === 0 ? "low" : "medium") as "low" | "medium",
      extra_headers: { "X-Preset": suffix },
      light_model: {
        model: "saved-light",
        backend: "openai-responses" as const,
        api_key_env: "SAVED_API_KEY",
      },
      created_at: "2026-09-08T00:00:00Z",
      updated_at: "2026-09-08T00:00:00Z",
    })),
  });
  vi.spyOn(api, "resolveModelConfig").mockResolvedValue({
    backend: "openai-responses",
    model: "gpt-5.6-sol",
    base_url: "https://api.openai.com/v1",
    api_key_env: "SAVED_API_KEY",
    reasoning_effort: "high",
    models: [{ id: "gpt-5.6-sol", display_name: "GPT-5.6 Sol" }],
    models_error: null,
  });
  const onChange = vi.fn<(selection: LaunchModelSelection | null) => void>();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfigurationsPanel
          invalid={false}
          initial={{
            backend: "openai-responses",
            model: "gpt-5.6-sol",
            base_url: "https://api.openai.com/v1",
            api_key_env: "SAVED_API_KEY",
            reasoning_effort: "high",
            extra_headers: { "X-Inherited": "exact" },
          }}
          onChange={onChange}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  try {
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          kind: "resolved",
          reasoning_effort: "high",
          extra_headers: { "X-Inherited": "exact" },
          light_model: undefined,
        }),
      ),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});
