/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ModelPicker } from "@/app/components/inspector/ModelPicker";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import { useSessionSnapshot } from "@/app/services/queries/session";
import type {
  ManagedHostStatus,
  ModelCatalog,
  SessionMetadata,
  SessionSnapshotResponse,
} from "@/app/types/api";

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

it("atomically resets Fast to Standard when the target Codex capability is unknown", async () => {
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const { client, view } = renderPicker({
    backend: "chatgpt-codex-responses",
    model: "previous-model",
    base_url: "https://chatgpt.com/backend-api",
    api_key_env: null,
    reasoning_effort: "high",
    service_tier: "fast",
  } as SessionMetadata);
  try {
    const button = await screen.findByRole("button", { name: "Model" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.change(screen.getByPlaceholderText("Search models…"), {
      target: { value: "GPT-5.6 Sol" },
    });
    fireEvent.click(await screen.findByText("GPT-5.6 Sol"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", {
        model: "gpt-5.6-sol",
        reasoning_effort: "high",
        service_tier: "standard",
      }),
    );
    expect(await screen.findByText(/speed reset to Standard/)).toBeTruthy();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("keeps controls locked when the accepted change cannot refresh the snapshot", async () => {
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const metadata = {
    backend: "arcee-auth",
    model: "trinity-large-thinking",
    base_url: "https://api.arcee.ai/api/v1",
    api_key_env: null,
    reasoning_effort: "high",
  } as SessionMetadata;
  function ActiveSnapshot() {
    useQuery({
      queryKey: queryKeys.sessionSnapshot("session"),
      queryFn: () => Promise.reject(new Error("offline")),
      initialData: { metadata },
      staleTime: Infinity,
      retry: false,
    });
    return (
      <ModelPicker
        sessionId="session"
        metadata={metadata}
        label={metadata.model}
        disabled={false}
      />
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ActiveSnapshot />
      </ToastProvider>
    </QueryClientProvider>,
  );
  try {
    const button = await screen.findByRole("button", { name: "Model" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.change(screen.getByPlaceholderText("Search models…"), {
      target: { value: "GPT-5.6 Sol" },
    });
    fireEvent.click(await screen.findByText("GPT-5.6 Sol"));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    expect(
      await screen.findByText(/Settings were saved, but the latest session could not be loaded/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry settings refresh" })).toBeTruthy();
  } finally {
    view.unmount();
    client.clear();
    update.mockRestore();
  }
});

it("preserves snapshot retry behavior with the passive guard mounted", async () => {
  const metadata = {
    session_id: "session",
    backend: "arcee-auth",
    model: "trinity-large-thinking",
    base_url: "https://api.arcee.ai/api/v1",
    api_key_env: null,
    reasoning_effort: "high",
  } as SessionMetadata;
  const snapshot = {
    metadata,
    messages: [],
    message_created_at: [],
    message_page: { start: 0, end: 0, total: 0, has_older: false },
    response_timing: {
      response_durations_ms: [],
      last_response_duration_ms: null,
      previous_response_duration_ms: null,
    },
    thread_events: {},
    worksets: { items: [], error: null },
  } as unknown as SessionSnapshotResponse;
  const update = vi.spyOn(api, "updateConfig").mockResolvedValueOnce(undefined);
  const fetch = vi
    .spyOn(api, "getSession")
    .mockRejectedValueOnce(new Error("transient"))
    .mockResolvedValueOnce(snapshot);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: 1, retryDelay: 0 }, mutations: { retry: false } },
  });
  function ActiveSnapshot() {
    useSessionSnapshot("session", { initialData: snapshot, staleTime: Infinity });
    return (
      <ModelPicker
        sessionId="session"
        metadata={metadata}
        label={metadata.model}
        disabled={false}
      />
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ActiveSnapshot />
      </ToastProvider>
    </QueryClientProvider>,
  );
  try {
    const button = await screen.findByRole("button", { name: "Model" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.change(screen.getByPlaceholderText("Search models…"), {
      target: { value: "GPT-5.6 Sol" },
    });
    fireEvent.click(await screen.findByText("GPT-5.6 Sol"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(update).toHaveBeenCalledOnce();
    expect(client.getQueryState(queryKeys.sessionSnapshot("session"))?.status).toBe("success");
    expect(screen.queryByRole("button", { name: "Retry settings refresh" })).toBeNull();
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
    update.mockRestore();
  }
});
