/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { expect, it, vi } from "vitest";

import { useReadyManagedProviderModels } from "@/app/features/managed/queries";
import { api } from "@/app/services/api";
import type { ManagedHostStatus, ModelCatalog } from "@/app/types/api";

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
  const hook = renderHook(() => useReadyManagedProviderModels(catalog), { wrapper });
  try {
    await waitFor(() => expect(hook.result.current.get("arcee-api")).toEqual(models));
    expect(discovery).toHaveBeenCalledExactlyOnceWith({
      backend: "arcee-api",
      base_url: "https://api.arcee.ai/api/v1",
    });
  } finally {
    hook.unmount();
    client.clear();
    host.mockRestore();
    discovery.mockRestore();
  }
});
