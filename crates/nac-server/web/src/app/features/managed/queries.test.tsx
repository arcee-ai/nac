/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { expect, it, vi } from "vitest";

import {
  managedQueryKeys,
  useManagedProviderModels,
  useReadyProviderModels,
} from "@/app/features/managed/queries";
import { api } from "@/app/services/api";
import { refreshProviderAuthentication } from "@/app/services/queries/configuration";
import { queryKeys } from "@/app/services/queries/keys";
import type { ManagedHostStatus, ModelCatalog } from "@/app/types/api";

it("invalidates cached catalog metadata when Codex discovery completes", async () => {
  const discovery = vi.spyOn(api, "listProviderModels").mockResolvedValue({
    base_url: "https://chatgpt.com/backend-api",
    models: [{ id: "gpt-6.1-sol", display_name: "GPT-6.1-Sol" }],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.modelCatalog, { catalog_version: 1, providers: [] });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useManagedProviderModels("chatgpt-codex-responses", true), {
    wrapper,
  });
  try {
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(client.getQueryState(queryKeys.modelCatalog)?.isInvalidated).toBe(true);
  } finally {
    hook.unmount();
    client.clear();
    discovery.mockRestore();
  }
});

it("does not reuse Codex availability after the catalog version changes", async () => {
  const catalog: ModelCatalog = {
    catalog_version: 1,
    providers: [
      {
        id: "chatgpt-codex-responses",
        auth: "codex_oauth",
        auth_status: "ready",
        auth_hint: null,
        connection: {
          allow_insecure_http: false,
          base_url: "https://chatgpt.com/backend-api",
          api_key_env: null,
        },
        default_base_url: null,
        managed_base_url: "https://chatgpt.com/backend-api",
        default_limits: { context_window: 128000, max_tokens: 16384, supported_efforts: [] },
        models: [],
      },
    ],
  };
  const next = Promise.withResolvers<Awaited<ReturnType<typeof api.listProviderModels>>>();
  const host = vi.spyOn(api, "getManagedStatus").mockRejectedValue(new Error("not managed"));
  const discovery = vi
    .spyOn(api, "listProviderModels")
    .mockResolvedValueOnce({
      base_url: "https://chatgpt.com/backend-api",
      models: [{ id: "old-account", display_name: null }],
    })
    .mockReturnValueOnce(next.promise);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ current }: { current: ModelCatalog }) => useReadyProviderModels(current),
    { wrapper, initialProps: { current: catalog } },
  );
  try {
    await waitFor(() =>
      expect(hook.result.current.get("chatgpt-codex-responses")).toEqual([
        { id: "old-account", display_name: null },
      ]),
    );
    hook.rerender({ current: { ...catalog, catalog_version: 2 } });
    await waitFor(() => expect(discovery).toHaveBeenCalledTimes(2));
    expect(hook.result.current.get("chatgpt-codex-responses")).toBeNull();
    await act(async () =>
      next.resolve({
        base_url: "https://chatgpt.com/backend-api",
        models: [{ id: "new-account", display_name: null }],
      }),
    );
    await waitFor(() =>
      expect(hook.result.current.get("chatgpt-codex-responses")).toEqual([
        { id: "new-account", display_name: null },
      ]),
    );
  } finally {
    hook.unmount();
    client.clear();
    host.mockRestore();
    discovery.mockRestore();
  }
});

it("loads all mounted-key models without sending a browser credential", async () => {
  // The hook reads only the model/auth fields in these response fixtures.
  const status = {
    model_ready: true,
    model: {
      backend: "arcee-api",
      id: "trinity-large-thinking",
      endpoint: "https://api.arcee.ai/api/v1",
    },
  } as ManagedHostStatus;
  const catalog: ModelCatalog = {
    catalog_version: 1,
    providers: [
      {
        id: "arcee-api",
        auth: "api_key_env",
        auth_status: "ready",
        connection: {
          allow_insecure_http: false,
          base_url: "https://api.arcee.ai/api/v1",
          api_key_env: null,
        },
        models: [],
        auth_hint: null,
        default_base_url: "https://api.arcee.ai/api/v1",
        managed_base_url: null,
        default_limits: { context_window: 128000, max_tokens: 4096, supported_efforts: [] },
      },
    ],
  };
  const models = [
    { id: "trinity-large-thinking", display_name: "Trinity" },
    { id: "moonshotai/kimi-k3", display_name: "Kimi" },
  ];
  const host = vi.spyOn(api, "getManagedStatus").mockResolvedValue(status);
  const discovery = vi.spyOn(api, "listProviderModels").mockResolvedValue({
    base_url: status.model.endpoint,
    models,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useReadyProviderModels(catalog), { wrapper });
  try {
    await waitFor(() => expect(hook.result.current.get("arcee-api")).toEqual(models));
    expect(discovery).toHaveBeenCalledExactlyOnceWith(
      {
        backend: "arcee-api",
        base_url: "https://api.arcee.ai/api/v1",
        allow_insecure_http: false,
      },
      expect.any(AbortSignal),
    );
  } finally {
    hook.unmount();
    client.clear();
    host.mockRestore();
    discovery.mockRestore();
  }
});

it("leaves the overlay absent when live entitlement discovery fails", async () => {
  const status = {
    model_ready: true,
    model: {
      backend: "arcee-api",
      id: "trinity-large-thinking",
      endpoint: "https://api.arcee.ai/api/v1",
    },
  } as ManagedHostStatus;
  const catalog: ModelCatalog = {
    catalog_version: 1,
    providers: [
      {
        id: "arcee-api",
        auth: "api_key_env",
        auth_status: "ready",
        connection: {
          allow_insecure_http: false,
          base_url: status.model.endpoint,
          api_key_env: null,
        },
        models: [],
        auth_hint: null,
        default_base_url: status.model.endpoint,
        managed_base_url: null,
        default_limits: { context_window: 128000, max_tokens: 4096, supported_efforts: [] },
      },
    ],
  };
  const host = vi.spyOn(api, "getManagedStatus").mockResolvedValue(status);
  const discovery = vi.spyOn(api, "listProviderModels").mockRejectedValue(new Error("offline"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useReadyProviderModels(catalog), { wrapper });
  try {
    await waitFor(() =>
      expect(
        client.getQueryState([
          ...managedQueryKeys.providerModels(status.model.backend, status.model.endpoint),
          null,
          false,
        ])?.status,
      ).toBe("error"),
    );
    expect(hook.result.current.has("arcee-api")).toBe(false);
  } finally {
    hook.unmount();
    client.clear();
    host.mockRestore();
    discovery.mockRestore();
  }
});

it("keeps a successful empty entitlement index distinct from unavailable discovery", async () => {
  const status = {
    model_ready: true,
    model: {
      backend: "arcee-api",
      id: "trinity-large-thinking",
      endpoint: "https://api.arcee.ai/api/v1",
    },
  } as ManagedHostStatus;
  const catalog: ModelCatalog = {
    catalog_version: 1,
    providers: [
      {
        id: "arcee-api",
        auth: "api_key_env",
        auth_status: "ready",
        connection: {
          allow_insecure_http: false,
          base_url: status.model.endpoint,
          api_key_env: null,
        },
        models: [],
        auth_hint: null,
        default_base_url: status.model.endpoint,
        managed_base_url: null,
        default_limits: { context_window: 128000, max_tokens: 4096, supported_efforts: [] },
      },
    ],
  };
  const host = vi.spyOn(api, "getManagedStatus").mockResolvedValue(status);
  const discovery = vi.spyOn(api, "listProviderModels").mockResolvedValue({
    base_url: status.model.endpoint,
    models: [],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useReadyProviderModels(catalog), { wrapper });
  try {
    await waitFor(() => expect(hook.result.current.get("arcee-api")).toEqual([]));
  } finally {
    hook.unmount();
    client.clear();
    host.mockRestore();
    discovery.mockRestore();
  }
});

it("aborts obsolete entitlement reads and refreshes the active account even when catalog identity stays ready", async () => {
  const status = {
    model_ready: true,
    model: {
      backend: "arcee-api",
      id: "new-account-model",
      endpoint: "https://api.arcee.ai/api/v1",
    },
  } as ManagedHostStatus;
  const catalog: ModelCatalog = {
    catalog_version: 1,
    providers: [
      {
        id: "arcee-api",
        auth: "api_key_env",
        auth_status: "ready",
        connection: {
          allow_insecure_http: false,
          base_url: status.model.endpoint,
          api_key_env: null,
        },
        models: [],
        auth_hint: null,
        default_base_url: status.model.endpoint,
        managed_base_url: null,
        default_limits: { context_window: 128000, max_tokens: 4096, supported_efforts: [] },
      },
    ],
  };
  const old = Promise.withResolvers<Awaited<ReturnType<typeof api.listProviderModels>>>();
  const host = vi.spyOn(api, "getManagedStatus").mockResolvedValue(status);
  const discovery = vi
    .spyOn(api, "listProviderModels")
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue({
      base_url: status.model.endpoint,
      models: [{ id: "new-account-model", display_name: "New account" }],
    });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useReadyProviderModels(catalog), { wrapper });
  try {
    await waitFor(() => expect(discovery).toHaveBeenCalledTimes(1));
    const oldSignal = discovery.mock.calls[0]?.[1];
    await act(async () => {
      await refreshProviderAuthentication(client);
    });
    expect(oldSignal?.aborted).toBe(true);
    await waitFor(() =>
      expect(hook.result.current.get("arcee-api")).toEqual([
        { id: "new-account-model", display_name: "New account" },
      ]),
    );
    await act(async () => {
      old.resolve({
        base_url: status.model.endpoint,
        models: [{ id: "obsolete-model", display_name: "Old account" }],
      });
    });
    expect(hook.result.current.get("arcee-api")).toEqual([
      { id: "new-account-model", display_name: "New account" },
    ]);
    expect(discovery).toHaveBeenCalledTimes(2);
  } finally {
    hook.unmount();
    client.clear();
    host.mockRestore();
    discovery.mockRestore();
  }
});
