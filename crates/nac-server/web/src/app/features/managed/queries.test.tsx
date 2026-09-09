/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";

import {
  managedQueryKeys,
  settleManagedUpgradeBlocker,
  useReadyManagedProviderModels,
} from "@/app/features/managed/queries";
import { api } from "@/app/services/api";
import type { ManagedHostStatus, ModelCatalog } from "@/app/types/api";

afterEach(() => vi.restoreAllMocks());

it("dispatches each actionable upgrade blocker through its ordinary exact resource API", async () => {
  const cancelRun = vi.spyOn(api, "cancelActiveRun").mockResolvedValue(undefined);
  const cancelChild = vi.spyOn(api, "cancelTraditionalChild").mockResolvedValue({} as never);
  const cancelOrchestrator = vi
    .spyOn(api, "cancelManagedOrchestrator")
    .mockResolvedValue({} as never);
  const terminate = vi.spyOn(api, "terminateTerminal").mockResolvedValue(undefined);
  const cancelClone = vi.spyOn(api, "cancelManagedClone").mockResolvedValue({} as never);

  const fixtures = [
    {
      action: "cancel_active_run" as const,
      target: { session_id: "session-1", run_id: "run-1" },
    },
    {
      action: "cancel_traditional_child" as const,
      target: { session_id: "session-2", child_session_id: "child-2" },
    },
    {
      action: "cancel_managed_orchestrator" as const,
      target: { session_id: "session-3", orchestrator_session_id: "orchestrator-3" },
    },
    {
      action: "terminate_terminal" as const,
      target: { session_id: "session-4", terminal_id: "terminal-4" },
    },
    {
      action: "cancel_clone_operation" as const,
      target: { clone_operation_id: "clone-5" },
    },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    await settleManagedUpgradeBlocker({
      selection_key: `sha256:${String(index).repeat(64)}`,
      kind: "fixture",
      message: "fixture",
      actionable: true,
      ...fixture,
    });
  }

  expect(cancelRun).toHaveBeenCalledExactlyOnceWith("session-1", "run-1");
  expect(cancelChild).toHaveBeenCalledExactlyOnceWith("session-2", "child-2");
  expect(cancelOrchestrator).toHaveBeenCalledExactlyOnceWith("session-3", "orchestrator-3");
  expect(terminate).toHaveBeenCalledExactlyOnceWith("session-4", "terminal-4");
  expect(cancelClone).toHaveBeenCalledExactlyOnceWith("clone-5");
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
  const hook = renderHook(() => useReadyManagedProviderModels(catalog), { wrapper });
  try {
    await waitFor(() =>
      expect(
        client.getQueryState(
          managedQueryKeys.providerModels(status.model.backend, status.model.endpoint),
        )?.status,
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
  const hook = renderHook(() => useReadyManagedProviderModels(catalog), { wrapper });
  try {
    await waitFor(() => expect(hook.result.current.get("arcee-api")).toEqual([]));
  } finally {
    hook.unmount();
    client.clear();
    host.mockRestore();
    discovery.mockRestore();
  }
});
