/** @vitest-environment jsdom */

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { renderHook, waitFor } from "@testing-library/react";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type { PropsWithChildren } from "react";
import { expect, it, vi } from "vitest";

import { isolatedRegistry } from "@/app/effect/remote";
import {
  managedProviderModelsAtom,
  managedProviderModelsKey,
  readyProviderModelsAtom,
} from "@/app/features/managed/queries";
import { apiEffect } from "@/app/services/api";
import type { ManagedHostStatus, ModelCatalog } from "@/app/types/api";

function catalogFixture(endpoint: string): ModelCatalog {
  return {
    catalog_version: 1,
    providers: [
      {
        id: "arcee-api",
        auth: "api_key_env",
        auth_status: "ready",
        connection: {
          base_url: endpoint,
          api_key_env: null,
        },
        models: [],
        auth_hint: null,
        default_base_url: endpoint,
        managed_base_url: null,
        default_limits: { context_window: 128000, max_tokens: 4096, supported_efforts: [] },
      },
    ],
  };
}

function hostStatus(endpoint: string): ManagedHostStatus {
  return {
    model_ready: true,
    model: {
      backend: "arcee-api",
      id: "trinity-large-thinking",
      endpoint,
    },
  } as ManagedHostStatus;
}

function mount(catalog: ModelCatalog) {
  const registry = isolatedRegistry();
  const wrapper = ({ children }: PropsWithChildren) => (
    <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
  );
  const hook = renderHook(() => useAtomValue(readyProviderModelsAtom(catalog)), { wrapper });
  return { registry, hook };
}

it("loads all mounted-key models without sending a browser credential", async () => {
  const endpoint = "https://api.arcee.ai/api/v1";
  const status = hostStatus(endpoint);
  const catalog = catalogFixture(endpoint);
  const models = [
    { id: "trinity-large-thinking", display_name: "Trinity" },
    { id: "moonshotai/kimi-k3", display_name: "Kimi" },
  ];
  const host = vi
    .spyOn(apiEffect, "getManagedStatus")
    .mockImplementation(() => Effect.promise(() => Promise.resolve(status)));
  const discovery = vi
    .spyOn(apiEffect, "listProviderModels")
    .mockImplementation(() =>
      Effect.promise(() => Promise.resolve({ base_url: status.model.endpoint, models })),
    );
  const { hook } = mount(catalog);
  try {
    await waitFor(() => expect(hook.result.current.get("arcee-api")).toEqual(models));
    expect(discovery).toHaveBeenCalledExactlyOnceWith({
      backend: "arcee-api",
      base_url: "https://api.arcee.ai/api/v1",
    });
  } finally {
    hook.unmount();
    host.mockRestore();
    discovery.mockRestore();
  }
});

it("leaves the overlay absent when live entitlement discovery fails", async () => {
  const endpoint = "https://api.arcee.ai/api/v1";
  const status = hostStatus(endpoint);
  const catalog = catalogFixture(endpoint);
  const host = vi
    .spyOn(apiEffect, "getManagedStatus")
    .mockImplementation(() => Effect.promise(() => Promise.resolve(status)));
  const discovery = vi
    .spyOn(apiEffect, "listProviderModels")
    .mockImplementation(() => Effect.promise(() => Promise.reject(new Error("offline"))));
  const { registry, hook } = mount(catalog);
  const modelsAtom = managedProviderModelsAtom(
    managedProviderModelsKey({ backend: status.model.backend, base_url: status.model.endpoint }),
  );
  try {
    await waitFor(() => expect(AsyncResult.isFailure(registry.get(modelsAtom))).toBe(true));
    expect(hook.result.current.has("arcee-api")).toBe(false);
  } finally {
    hook.unmount();
    host.mockRestore();
    discovery.mockRestore();
  }
});

it("keeps a successful empty entitlement index distinct from unavailable discovery", async () => {
  const endpoint = "https://api.arcee.ai/api/v1";
  const status = hostStatus(endpoint);
  const catalog = catalogFixture(endpoint);
  const host = vi
    .spyOn(apiEffect, "getManagedStatus")
    .mockImplementation(() => Effect.promise(() => Promise.resolve(status)));
  const discovery = vi
    .spyOn(apiEffect, "listProviderModels")
    .mockImplementation(() =>
      Effect.promise(() => Promise.resolve({ base_url: status.model.endpoint, models: [] })),
    );
  const { hook } = mount(catalog);
  try {
    await waitFor(() => expect(hook.result.current.get("arcee-api")).toEqual([]));
  } finally {
    hook.unmount();
    host.mockRestore();
    discovery.mockRestore();
  }
});
