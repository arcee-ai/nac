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
        {
          id: "deepseek-flash",
          display_name: "DeepSeek Flash",
          context_window: 128000,
          max_tokens: 4096,
          cost,
          reasoning: true,
          supported_efforts: [],
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

function renderPicker(metadata: SessionMetadata, disabled = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (busy: boolean) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ModelPicker
          sessionId="session"
          metadata={metadata}
          label={metadata.model}
          disabled={busy}
        />
      </ToastProvider>
    </QueryClientProvider>
  );
  const view = render(tree(disabled));
  return { client, view, setBusy: (busy: boolean) => view.rerender(tree(busy)) };
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
    reasoning_effort: "high",
  } as SessionMetadata);
  try {
    const modelButton = await screen.findByRole("button", { name: "Model" });
    await waitFor(() => expect((modelButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(modelButton);
    fireEvent.click(await screen.findByText("Kimi"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", {
        model: "moonshotai/kimi-k3",
        reasoning_effort: "high",
      }),
    );
    expect(discovery).toHaveBeenCalledWith(
      {
        backend: "arcee-api",
        base_url: "https://api.arcee.ai/api/v1",
      },
      expect.any(AbortSignal),
    );
    expect(discovery.mock.calls[0]?.[0]).not.toHaveProperty("api_key");
    expect(discovery.mock.calls[0]?.[0]).not.toHaveProperty("api_key_env");
  } finally {
    view.unmount();
    client.clear();
  }
});

it("gives a session without a level its standard one and offers only real levels", async () => {
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const { client, view } = renderPicker({
    backend: "arcee-auth",
    model: "trinity-large-thinking",
    base_url: "https://api.arcee.ai/api/v1",
    api_key_env: null,
    reasoning_effort: null,
  } as SessionMetadata);
  try {
    // The fixture model has Low and High, so its standard level is Low.
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", { reasoning_effort: "low" }),
    );
    const trigger = await screen.findByRole("button", { name: "Low" });
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(trigger);
    expect(await screen.findByRole("button", { name: "High" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Default" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith("session", { reasoning_effort: "high" }),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it("waits for the run to end before giving a session its standard level", async () => {
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const { client, view, setBusy } = renderPicker(
    {
      backend: "arcee-auth",
      model: "trinity-large-thinking",
      base_url: "https://api.arcee.ai/api/v1",
      api_key_env: null,
      reasoning_effort: null,
    } as SessionMetadata,
    true,
  );
  try {
    await screen.findByRole("button", { name: "Low" });
    expect(update).not.toHaveBeenCalled();
    setBusy(false);
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", { reasoning_effort: "low" }),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it("offers and sends no level for a model that accepts none", async () => {
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
    fireEvent.click(await screen.findByText("DeepSeek Flash"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", {
        model: "deepseek-flash",
        reasoning_effort: null,
      }),
    );
  } finally {
    view.unmount();
    client.clear();
  }

  update.mockClear();
  const second = renderPicker({
    backend: "arcee-auth",
    model: "deepseek-flash",
    base_url: "https://api.arcee.ai/api/v1",
    api_key_env: null,
    reasoning_effort: null,
  } as SessionMetadata);
  try {
    const modelButton = await screen.findByRole("button", { name: "Model" });
    await waitFor(() => expect((modelButton as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("button", { name: /^(Effort|Low|Medium|High)$/ })).toBeNull();
    expect(update).not.toHaveBeenCalled();
  } finally {
    second.view.unmount();
    second.client.clear();
  }
});
