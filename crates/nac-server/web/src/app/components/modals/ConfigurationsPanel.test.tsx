/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  ConfigurationsPanel,
  type LaunchModelSelection,
} from "@/app/components/modals/ConfigurationsPanel";
import { isolatedRegistry } from "@/app/effect/remote";
import {
  managedHostStatusAtom,
  managedProviderModelsAtom,
  managedProviderModelsKey,
} from "@/app/features/managed/queries";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { apiEffect } from "@/app/services/api";
import type {
  ManagedHostStatus,
  ModelCatalog,
  ModelConfigurationList,
  ResolvedModelConfiguration,
} from "@/app/types/api";

function spyResolved(method: string, value: unknown) {
  const target = apiEffect as unknown as Record<string, (...args: unknown[]) => unknown>;
  return vi
    .spyOn(target, method)
    .mockImplementation(() => Effect.promise(() => Promise.resolve(value)));
}

function spyRejected(method: string, error: unknown) {
  const target = apiEffect as unknown as Record<string, (...args: unknown[]) => unknown>;
  return vi
    .spyOn(target, method)
    .mockImplementation(() => Effect.promise(() => Promise.reject(error)));
}

function successValue(result: AsyncResult.AsyncResult<unknown, unknown>): unknown {
  return AsyncResult.isSuccess(result) ? result.value : undefined;
}

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
      connection: {
        base_url: "https://api.arcee.ai/api/v1",
        api_key_env: "ARCEE_API_KEY",
      },
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
  spyResolved("getManagedStatus", hostStatus);
  spyResolved("listModelConfigs", { configurations: [] });
  spyResolved("getModelCatalog", catalog);
  spyResolved("listProviderModels", {
    base_url: hostStatus.model.endpoint,
    models: [],
  });
  const onChange = vi.fn<(selection: LaunchModelSelection | null) => void>();
  const registry = isolatedRegistry();
  const view = render(
    <RegistryContext.Provider value={registry}>
      <ToastProvider>
        <ConfigurationsPanel invalid={false} onChange={onChange} />
      </ToastProvider>
    </RegistryContext.Provider>,
  );
  try {
    await waitFor(() =>
      expect(
        successValue(
          registry.get(
            managedProviderModelsAtom(
              managedProviderModelsKey({
                backend: "arcee-api",
                base_url: hostStatus.model.endpoint,
                api_key_env: "ARCEE_API_KEY",
              }),
            ),
          ),
        ),
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
  }
});

it("uses the configured managed default only when live discovery is unavailable", async () => {
  spyResolved("getManagedStatus", hostStatus);
  spyResolved("listModelConfigs", { configurations: [] });
  spyResolved("getModelCatalog", catalog);
  spyRejected("listProviderModels", new Error("offline"));
  const onChange = vi.fn<(selection: LaunchModelSelection | null) => void>();
  const registry = isolatedRegistry();
  const view = render(
    <RegistryContext.Provider value={registry}>
      <ToastProvider>
        <ConfigurationsPanel invalid={false} onChange={onChange} />
      </ToastProvider>
    </RegistryContext.Provider>,
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
  }
});

it("never emits a managed default between status, catalog, and entitlement hydration", async () => {
  const host = deferred<ManagedHostStatus>();
  const catalogRequest = deferred<ModelCatalog>();
  const entitlement = deferred<{
    base_url: string;
    models: Array<{ id: string; display_name: string | null }>;
  }>();
  spyResolved("getManagedStatus", host.promise);
  spyResolved("listModelConfigs", { configurations: [] });
  spyResolved("getModelCatalog", catalogRequest.promise);
  const discovery = spyResolved("listProviderModels", entitlement.promise);
  const onChange = vi.fn<(selection: LaunchModelSelection | null) => void>();
  const registry = isolatedRegistry();
  const view = render(
    <RegistryContext.Provider value={registry}>
      <ToastProvider>
        <ConfigurationsPanel invalid={false} onChange={onChange} />
      </ToastProvider>
    </RegistryContext.Provider>,
  );
  const onlyNullSelections = () =>
    onChange.mock.calls.length > 0 &&
    onChange.mock.calls.every(([selection]) => selection === null);
  try {
    host.resolve(hostStatus);
    await waitFor(() =>
      expect(successValue(registry.get(managedHostStatusAtom))).toEqual(hostStatus),
    );
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
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("waits for persisted configurations and managed status before emitting an implicit default", async () => {
  const host = deferred<ManagedHostStatus>();
  const configs = deferred<ModelConfigurationList>();
  spyResolved("getManagedStatus", host.promise);
  spyResolved("listModelConfigs", configs.promise);
  spyResolved("getModelCatalog", catalog);
  spyResolved("resolveModelConfig", {
    backend: "openai-responses",
    model: "gpt-5.6-sol",
    base_url: "https://api.openai.com/v1",
    allow_insecure_http: false,
    api_key_env: "SAVED_API_KEY",
    reasoning_effort: "high",
    models: [{ id: "gpt-5.6-sol", display_name: "GPT-5.6 Sol" }],
    models_error: null,
  } satisfies ResolvedModelConfiguration);
  const onChange = vi.fn<(selection: LaunchModelSelection | null) => void>();
  const registry = isolatedRegistry();
  const view = render(
    <RegistryContext.Provider value={registry}>
      <ToastProvider>
        <ConfigurationsPanel invalid={false} onChange={onChange} />
      </ToastProvider>
    </RegistryContext.Provider>,
  );
  try {
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.every(([selection]) => selection === null)).toBe(true);

    host.resolve(hostStatus);
    await waitFor(() =>
      expect(successValue(registry.get(managedHostStatusAtom))).toEqual(hostStatus),
    );
    expect(onChange.mock.calls.every(([selection]) => selection === null)).toBe(true);

    configs.resolve({
      configurations: [
        {
          config_id: "saved-config",
          name: "Saved provider",
          backend: "openai-responses",
          model: "gpt-5.6-sol",
          base_url: "https://api.openai.com/v1",
          allow_insecure_http: false,
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
  }
});

it("preserves exact inherited advanced settings when duplicate presets share basic identity", async () => {
  spyResolved("getManagedStatus", hostStatus);
  spyResolved("getModelCatalog", catalog);
  spyResolved("listModelConfigs", {
    configurations: ["first", "second"].map((suffix, index) => ({
      config_id: `saved-config-${suffix}`,
      name: `Saved provider ${suffix}`,
      backend: "openai-responses" as const,
      model: "gpt-5.6-sol",
      base_url: "https://api.openai.com/v1",
      allow_insecure_http: false,
      api_key_env: "SAVED_API_KEY",
      reasoning_effort: (index === 0 ? "low" : "medium") as "low" | "medium",
      extra_headers: { "X-Preset": suffix },
      light_model: {
        model: "saved-light",
        backend: "openai-responses" as const,
        api_key_env: "SAVED_API_KEY",
      },
      orchestrator_compaction_threshold: index === 0 ? 111 : 222,
      created_at: "2026-09-08T00:00:00Z",
      updated_at: "2026-09-08T00:00:00Z",
    })),
  });
  spyResolved("resolveModelConfig", {
    backend: "openai-responses",
    model: "gpt-5.6-sol",
    base_url: "https://api.openai.com/v1",
    allow_insecure_http: false,
    api_key_env: "SAVED_API_KEY",
    reasoning_effort: "high",
    models: [{ id: "gpt-5.6-sol", display_name: "GPT-5.6 Sol" }],
    models_error: null,
  });
  const onChange = vi.fn<(selection: LaunchModelSelection | null) => void>();
  const registry = isolatedRegistry();
  const view = render(
    <RegistryContext.Provider value={registry}>
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
    </RegistryContext.Provider>,
  );
  try {
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          kind: "resolved",
          reasoning_effort: "high",
          extra_headers: { "X-Inherited": "exact" },
          light_model: undefined,
          orchestrator_compaction_threshold: undefined,
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create New" }));
    fireEvent.click(await screen.findByText("Saved provider second"));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          config_id: "saved-config-second",
          orchestrator_compaction_threshold: 222,
        }),
      ),
    );
  } finally {
    view.unmount();
  }
});

it("emits a custom public HTTPS endpoint without a separate trust repair", async () => {
  spyResolved("getManagedStatus", hostStatus);
  spyResolved("listModelConfigs", { configurations: [] });
  spyResolved("getModelCatalog", catalog);
  const discovery = spyResolved("listProviderModels", { base_url: "", models: [] });
  const onChange = vi.fn<(selection: LaunchModelSelection | null) => void>();
  const registry = isolatedRegistry();
  const view = render(
    <RegistryContext.Provider value={registry}>
      <ToastProvider>
        <ConfigurationsPanel invalid={false} onChange={onChange} />
      </ToastProvider>
    </RegistryContext.Provider>,
  );
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Browse Models" }));
    fireEvent.click(screen.getByRole("button", { name: "Create New" }));
    fireEvent.click(screen.getByRole("button", { name: "Arcee API (Key)" }));
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.click(screen.getByRole("button", { name: "Arcee API (Key)" }));
    fireEvent.click(screen.getByRole("button", { name: "OpenAI Responses" }));

    fireEvent.change(screen.getByPlaceholderText("Paste the provider key"), {
      target: { value: "custom-secret" },
    });
    fireEvent.change(screen.getByPlaceholderText("gpt-5.5"), {
      target: { value: "custom-model" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://api.openai.com/v1"), {
      target: { value: "https://gateway.noncanonical.example/v1" },
    });

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        kind: "save",
        request: {
          name: "custom-config-1",
          backend: "openai-responses",
          model: "custom-model",
          base_url: "https://gateway.noncanonical.example/v1",
          allow_insecure_http: false,
          api_key: "custom-secret",
        },
      }),
    );
    expect(discovery).not.toHaveBeenCalledWith(
      expect.objectContaining({
        api_key: "custom-secret",
        base_url: "https://gateway.noncanonical.example/v1",
      }),
    );
  } finally {
    view.unmount();
  }
});

it("requires an explicit warning-backed switch before emitting public HTTP opt-in", async () => {
  spyResolved("getManagedStatus", hostStatus);
  spyResolved("listModelConfigs", { configurations: [] });
  spyResolved("getModelCatalog", catalog);
  const onChange = vi.fn<(selection: LaunchModelSelection | null) => void>();
  const registry = isolatedRegistry();
  const view = render(
    <RegistryContext.Provider value={registry}>
      <ToastProvider>
        <ConfigurationsPanel invalid={false} onChange={onChange} />
      </ToastProvider>
    </RegistryContext.Provider>,
  );
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Browse Models" }));
    fireEvent.click(screen.getByRole("button", { name: "Create New" }));
    fireEvent.click(screen.getByRole("button", { name: "Arcee API (Key)" }));
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.click(screen.getByRole("button", { name: "Arcee API (Key)" }));
    fireEvent.click(screen.getByRole("button", { name: "OpenAI Responses" }));

    expect(
      screen.getByText(
        "Your API key, prompts, source code, tool output, and model responses may be read or modified in transit.",
      ),
    ).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "Allow insecure HTTP" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByPlaceholderText("Paste the provider key"), {
      target: { value: "custom-secret" },
    });
    fireEvent.change(screen.getByPlaceholderText("gpt-5.5"), {
      target: { value: "custom-model" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://api.openai.com/v1"), {
      target: { value: "http://gateway.example/v1" },
    });

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        kind: "save",
        request: {
          name: "custom-config-1",
          backend: "openai-responses",
          model: "custom-model",
          base_url: "http://gateway.example/v1",
          allow_insecure_http: true,
          api_key: "custom-secret",
        },
      }),
    );
  } finally {
    view.unmount();
  }
});
