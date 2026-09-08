/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
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
