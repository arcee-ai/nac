/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ModelPicker } from "@/app/components/inspector/ModelPicker";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys, useSessionSnapshot } from "@/app/services/queries";
import type {
  ManagedHostStatus,
  ModelCatalog,
  RawSessionConfig,
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

function mockRawConfig(metadata: SessionMetadata) {
  const config: RawSessionConfig = {
    session_id: "session",
    backend: metadata.backend,
    model: metadata.model,
    base_url: metadata.base_url ?? "",
    allow_insecure_http: false,
    api_key_env: metadata.api_key_env ?? null,
    reasoning_effort: metadata.reasoning_effort ?? null,
    service_tier: metadata.service_tier ?? null,
    extra_headers_json: null,
    orchestrator_compaction_threshold: null,
    config_version: 7,
  };
  vi.spyOn(api, "getConfig").mockImplementation(async () => {
    const patch = vi.isMockFunction(api.updateConfig)
      ? vi.mocked(api.updateConfig).mock.calls.at(-1)?.[1]
      : undefined;
    if (!patch) return config;
    return {
      ...config,
      ...patch,
      extra_headers_json:
        patch.extra_headers === undefined
          ? config.extra_headers_json
          : JSON.stringify(patch.extra_headers ?? {}),
      config_version: config.config_version + 1,
    } as RawSessionConfig;
  });
}

function renderPicker(metadata: SessionMetadata, disabled = false) {
  mockRawConfig(metadata);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (busy: boolean) => (
    <MemoryRouter>
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
    </MemoryRouter>
  );
  const view = render(tree(disabled));
  return { client, view, setBusy: (busy: boolean) => view.rerender(tree(busy)) };
}

async function openChip(name: string | RegExp) {
  const chip = await screen.findByRole("button", { name });
  await waitFor(() => expect((chip as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(chip);
  return chip;
}

async function pickModel(chipName: string | RegExp, model: string) {
  await openChip(chipName);
  fireEvent.click(screen.getByRole("button", { name: /^Choose model/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search models" }), {
    target: { value: model },
  });
  fireEvent.click(await screen.findByRole("menuitemradio", { name: new RegExp(`^${model}`) }));
}

const trinity = {
  backend: "arcee-auth",
  model: "trinity-large-thinking",
  base_url: "https://api.arcee.ai/api/v1",
  api_key_env: null,
} as const;

it("switches the same model to a new endpoint without carrying old credentials", async () => {
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const { client, view } = renderPicker({
    ...trinity,
    base_url: "https://old.example/v1",
    api_key_env: "OLD_KEY",
    reasoning_effort: "high",
  } as SessionMetadata);
  try {
    await pickModel("Model: Trinity, High reasoning", "Trinity");
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", {
        backend: "arcee-auth",
        model: "trinity-large-thinking",
        base_url: "https://api.arcee.ai/api/v1",
        allow_insecure_http: false,
        api_key_env: null,
        reasoning_effort: "high",
        extra_headers: null,
        expected_config_version: 7,
      }),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it("switches from an Arcee account to Codex through one catalog mutation", async () => {
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const { client, view } = renderPicker({
    ...trinity,
    reasoning_effort: "high",
  } as SessionMetadata);
  try {
    await pickModel("Model: Trinity, High reasoning", "GPT-5.6 Sol");
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", {
        backend: "chatgpt-codex-responses",
        model: "gpt-5.6-sol",
        base_url: "https://chatgpt.com/backend-api",
        allow_insecure_http: false,
        api_key_env: null,
        reasoning_effort: "high",
        extra_headers: null,
        expected_config_version: 7,
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
    ...trinity,
    backend: "arcee-api",
    reasoning_effort: "high",
  } as SessionMetadata);
  try {
    await pickModel(/^Model: Trinity/, "Kimi");
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", {
        model: "moonshotai/kimi-k3",
        reasoning_effort: "high",
        expected_config_version: 7,
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

it("keeps an unset level until the user chooses a supported level", async () => {
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const { client, view } = renderPicker({ ...trinity, reasoning_effort: null } as SessionMetadata);
  try {
    await openChip("Model: Trinity");
    expect(update).not.toHaveBeenCalled();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "Low" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "High" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", {
        reasoning_effort: "high",
        expected_config_version: 7,
      }),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it("does not write a reasoning level when a run ends", async () => {
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const { client, view, setBusy } = renderPicker(
    { ...trinity, reasoning_effort: null } as SessionMetadata,
    true,
  );
  try {
    const chip = await screen.findByRole("button", {
      name: "Model: Trinity",
    });
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    expect(update).not.toHaveBeenCalled();
    setBusy(false);
    await waitFor(() => expect((chip as HTMLButtonElement).disabled).toBe(false));
    expect(update).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("shows effort as None and sends none for a model that accepts no level", async () => {
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const { client, view } = renderPicker({
    ...trinity,
    reasoning_effort: "high",
  } as SessionMetadata);
  try {
    await pickModel("Model: Trinity, High reasoning", "DeepSeek Flash");
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", {
        model: "deepseek-flash",
        reasoning_effort: null,
        expected_config_version: 7,
      }),
    );
  } finally {
    view.unmount();
    client.clear();
  }

  update.mockClear();
  const second = renderPicker({
    ...trinity,
    model: "deepseek-flash",
    reasoning_effort: null,
  } as SessionMetadata);
  try {
    await openChip("Model: DeepSeek Flash, None reasoning");
    expect(screen.queryByRole("group", { name: /^Reasoning/ })).toBeNull();
    expect(update).not.toHaveBeenCalled();
  } finally {
    second.view.unmount();
    second.client.clear();
  }
});

it("does not retry a write with an uncertain outcome", async () => {
  const update = vi
    .spyOn(api, "updateConfig")
    .mockRejectedValue(new TypeError("Network disconnected"));
  const { client, view } = renderPicker({ ...trinity, reasoning_effort: "low" } as SessionMetadata);
  try {
    await openChip("Model: Trinity, Low reasoning");
    fireEvent.click(screen.getByRole("radio", { name: "High" }));
    await screen.findByText(/save outcome is unknown/i);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /^Model: Trinity/ }).disabled,
    ).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    client.clear();
  }
});

it("lists a managed host's mounted provider before its account reads as connected", async () => {
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
        auth_status: "missing",
        default_base_url: "https://api.arcee.ai/api/v1",
        managed_base_url: null,
      },
      catalog.providers[1],
    ],
  } as ModelCatalog);
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const { client, view } = renderPicker({
    backend: "chatgpt-codex-responses",
    model: "gpt-5.6-sol",
    base_url: "https://chatgpt.com/backend-api",
    api_key_env: null,
    reasoning_effort: "high",
  } as SessionMetadata);
  try {
    await pickModel("Model: GPT-5.6 Sol, High reasoning", "Trinity");
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith(
        "session",
        expect.objectContaining({
          backend: "arcee-api",
          model: "trinity-large-thinking",
          base_url: "https://api.arcee.ai/api/v1",
        }),
      ),
    );
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
    await pickModel(/^Model: previous-model/, "GPT-5.6 Sol");
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", {
        model: "gpt-5.6-sol",
        reasoning_effort: "high",
        service_tier: "standard",
        expected_config_version: 7,
      }),
    );
    expect(await screen.findByText(/speed changed to Standard/i)).toBeTruthy();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("requires explicit confirmation to switch to a model that does not accept speed", async () => {
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const { client, view } = renderPicker({
    backend: "chatgpt-codex-responses",
    model: "gpt-5.6-sol",
    base_url: "https://chatgpt.com/backend-api",
    api_key_env: null,
    reasoning_effort: "high",
    service_tier: "fast",
  } as SessionMetadata);
  try {
    await pickModel(/^Model: GPT-5.6 Sol/, "Trinity");
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText("This model does not accept the selected speed.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch model and clear speed" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("session", {
        ...trinity,
        allow_insecure_http: false,
        reasoning_effort: "high",
        service_tier: null,
        expected_config_version: 7,
        extra_headers: null,
      }),
    );
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
  mockRawConfig(metadata);
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
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ActiveSnapshot />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  try {
    await pickModel(/^Model: Trinity/, "GPT-5.6 Sol");
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    await screen.findByText(/Reload before editing again/);
    const chip = screen.getByRole<HTMLButtonElement>("button", { name: /^Model:/ });
    expect(chip.disabled).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Model settings" })).toBeNull();
    expect(
      await screen.findByText(/Settings were saved, but the latest session could not be loaded/),
    ).toBeTruthy();
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
  mockRawConfig(metadata);
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
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ActiveSnapshot />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  try {
    const button = await screen.findByRole("button", { name: /^Model: Trinity/ });
    await pickModel(/^Model: Trinity/, "GPT-5.6 Sol");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(update).toHaveBeenCalledOnce();
    expect(client.getQueryState(queryKeys.sessionSnapshot("session"))?.status).toBe("success");
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
    update.mockRestore();
  }
});

it("waits through stale successful readback until the accepted revision and model arrive", async () => {
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const metadata = {
    backend: "arcee-auth",
    model: "trinity-large-thinking",
    base_url: "https://api.arcee.ai/api/v1",
    api_key_env: null,
    reasoning_effort: "high",
  } as SessionMetadata;
  const { client, view } = renderPicker(metadata);
  try {
    await screen.findByRole("button", { name: /^Model: Trinity/ });
    const initial = client.getQueryData<RawSessionConfig>(queryKeys.sessionConfig("session"))!;
    vi.mocked(api.getConfig).mockResolvedValue(initial);
    await pickModel(/^Model: Trinity/, "GPT-5.6 Sol");
    await waitFor(() => expect(api.getConfig).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /^Model: Trinity/ }).disabled,
    ).toBe(true);
    expect(screen.queryByText(/Model switched/)).toBeNull();
    client.setQueryData(queryKeys.sessionConfig("session"), {
      ...initial,
      backend: "chatgpt-codex-responses",
      model: "gpt-5.6-sol",
      base_url: "https://chatgpt.com/backend-api",
      api_key_env: null,
      allow_insecure_http: false,
      extra_headers_json: "{}",
      config_version: initial.config_version + 1,
    });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: /^Model: GPT-5.6 Sol/ }).disabled,
      ).toBe(false),
    );
    expect(update).toHaveBeenCalledOnce();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("requires review when a newer readback does not match the accepted model change", async () => {
  vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const metadata = {
    backend: "arcee-auth",
    model: "trinity-large-thinking",
    base_url: "https://api.arcee.ai/api/v1",
    api_key_env: null,
    reasoning_effort: "high",
  } as SessionMetadata;
  const { client, view } = renderPicker(metadata);
  try {
    await screen.findByRole("button", { name: /^Model: Trinity/ });
    const initial = client.getQueryData<RawSessionConfig>(queryKeys.sessionConfig("session"))!;
    vi.mocked(api.getConfig).mockResolvedValue({
      ...initial,
      config_version: initial.config_version + 1,
    });
    await pickModel(/^Model: Trinity/, "GPT-5.6 Sol");
    await screen.findByText(/Reload before editing again/);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /^Model:/ }).disabled).toBe(true);
    expect(screen.queryByText(/Model switched/)).toBeNull();
  } finally {
    view.unmount();
    client.clear();
  }
});
