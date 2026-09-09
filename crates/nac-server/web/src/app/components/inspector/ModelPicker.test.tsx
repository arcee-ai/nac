/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ModelPicker } from "@/app/components/inspector/ModelPicker";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import type { ManagedHostStatus, ModelCatalog, SessionMetadata } from "@/app/types/api";

const cost = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
const catalog = {
  catalog_version: 1,
  providers: [
    {
      id: "arcee-auth",
      auth: "managed_arcee",
      auth_status: "ready",
      auth_hint: null,
      default_base_url: null,
      managed_base_url: "https://api.arcee.ai/api/v1",
      default_limits: {
        context_window: 128000,
        max_tokens: 4096,
        supported_efforts: ["low", "high"],
      },
      models: [
        {
          id: "trinity-large-thinking",
          display_name: "Trinity",
          context_window: 128000,
          max_tokens: 4096,
          cost,
          reasoning: true,
          supported_efforts: ["low", "high"],
          source: "baseline",
        },
      ],
    },
    {
      id: "chatgpt-codex-responses",
      auth: "codex_oauth",
      auth_status: "ready",
      auth_hint: null,
      default_base_url: null,
      managed_base_url: "https://chatgpt.com/backend-api",
      default_limits: {
        context_window: 200000,
        max_tokens: 32000,
        supported_efforts: ["low", "high"],
      },
      models: [
        {
          id: "gpt-5.6-sol",
          display_name: "GPT-5.6 Sol",
          context_window: 200000,
          max_tokens: 32000,
          cost,
          reasoning: true,
          supported_efforts: ["low", "high"],
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
  vi.spyOn(api, "getModelCatalog").mockResolvedValue(catalog);
  vi.spyOn(api, "getManagedStatus").mockRejectedValue(new Error("unmanaged host"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPicker(metadata: SessionMetadata) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ModelPicker
          sessionId="session"
          metadata={metadata}
          label={metadata.model}
          disabled={false}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { client, view };
}

it("switches from an Arcee account to Codex through one catalog mutation", async () => {
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const { client, view } = renderPicker({
    backend: "arcee-auth",
    model: "trinity-large-thinking",
    base_url: "https://api.arcee.ai/api/v1",
    api_key_env: null,
    reasoning_effort: "high",
  } as SessionMetadata);
  try {
    const modelButton = await screen.findByRole("button", { name: "Model" });
    await waitFor(() => expect((modelButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(modelButton);
    fireEvent.change(screen.getByPlaceholderText("Search models…"), {
      target: { value: "GPT-5.6 Sol" },
    });
    fireEvent.click(await screen.findByText("GPT-5.6 Sol"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", {
        backend: "chatgpt-codex-responses",
        model: "gpt-5.6-sol",
        base_url: "https://chatgpt.com/backend-api",
        api_key_env: null,
        reasoning_effort: "high",
        extra_headers: null,
      }),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it("keeps managed mounted credentials server-side while selecting another entitled model", async () => {
  vi.mocked(api.getManagedStatus).mockResolvedValue({
    model_ready: true,
    model: {
      backend: "arcee-api",
      id: "trinity-large-thinking",
      endpoint: "https://api.arcee.ai/api/v1",
      display_name: "Managed Arcee",
    },
  } as ManagedHostStatus);
  vi.mocked(api.getModelCatalog).mockResolvedValue({
    ...catalog,
    providers: [
      {
        ...catalog.providers[0],
        id: "arcee-api",
        auth: "api_key_env",
        default_base_url: "https://api.arcee.ai/api/v1",
        managed_base_url: null,
      },
    ],
  } as ModelCatalog);
  const discovery = vi.spyOn(api, "listProviderModels").mockResolvedValue({
    base_url: "https://api.arcee.ai/api/v1",
    models: [
      { id: "trinity-large-thinking", display_name: "Trinity" },
      { id: "moonshotai/kimi-k3", display_name: "Kimi" },
    ],
  });
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const { client, view } = renderPicker({
    backend: "arcee-api",
    model: "trinity-large-thinking",
    base_url: "https://api.arcee.ai/api/v1",
    api_key_env: null,
    reasoning_effort: null,
  } as SessionMetadata);
  try {
    const modelButton = await screen.findByRole("button", { name: "Model" });
    await waitFor(() => expect((modelButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(modelButton);
    fireEvent.click(await screen.findByText("Kimi"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", {
        model: "moonshotai/kimi-k3",
        reasoning_effort: null,
      }),
    );
    expect(discovery).toHaveBeenCalledWith({
      backend: "arcee-api",
      base_url: "https://api.arcee.ai/api/v1",
    });
    expect(discovery.mock.calls[0]?.[0]).not.toHaveProperty("api_key");
    expect(discovery.mock.calls[0]?.[0]).not.toHaveProperty("api_key_env");
  } finally {
    view.unmount();
    client.clear();
  }
});
