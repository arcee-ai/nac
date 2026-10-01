/** @vitest-environment jsdom */

import { UiPolicyContext } from "@/app/features/ui-policy/UiPolicyContext";
import { ORCHESTRATION_UI_POLICY, DIRECT_UI_POLICY } from "@/app/features/ui-policy/policy";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SettingsModal } from "@/app/components/modals/SettingsModal";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api, ApiError } from "@/app/services/api";
import type {
  ManagedHostStatus,
  ManagedSessionSummary,
  ModelCatalog,
  RawSessionConfig,
  SessionSnapshotResponse,
} from "@/app/types/api";

vi.mock("@/app/components/modals/ConfigurationsPanel", () => ({
  ConfigurationsPanel: ({
    initial,
    onChange,
    children,
  }: {
    initial?: Record<string, unknown>;
    children?: React.ReactNode;
    onChange: (selection: Record<string, unknown>) => void;
  }) => {
    const select = (overrides: Record<string, unknown> = {}) =>
      onChange({
        kind: "resolved",
        ...initial,
        light_model: undefined,
        ...overrides,
      });
    return (
      <section>
        <button
          type="button"
          onClick={() =>
            select({
              backend: "arcee-api",
              model: "moonshotai/kimi-k3",
              base_url: "https://api.arcee.ai/api/v1",
              api_key_env: null,
              reasoning_effort: null,
              extra_headers: null,
            })
          }
        >
          Choose Kimi
        </button>
        <button type="button" onClick={() => select()}>
          Keep current configuration
        </button>
        <button
          type="button"
          onClick={() =>
            select({ config_id: "chosen-preset", orchestrator_compaction_threshold: 222 })
          }
        >
          Select preset threshold 222
        </button>
        <button type="button" onClick={() => select({ orchestrator_compaction_threshold: null })}>
          Select preset with compaction disabled
        </button>
        {children}
      </section>
    );
  },
}));

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderReadySettings({
  threshold = 111,
  headersJson = "{}",
  orchestration = true,
  lightModel = null,
  projectId = null,
  diagnostics = [],
}: {
  diagnostics?: string[];
  projectId?: string | null;
  threshold?: number | null;
  headersJson?: string;
  orchestration?: boolean;
  lightModel?: RawSessionConfig["light_model"];
} = {}) {
  const initial = {
    backend: "openai-responses",
    model: "gpt-5.2",
    base_url: "https://api.openai.com/v1",
    allow_insecure_http: false,
    api_key_env: "OPENAI_API_KEY",
    reasoning_effort: "high",
    extra_headers: {},
  };
  vi.spyOn(api, "getManagedStatus").mockResolvedValue({
    model_ready: false,
    model: {
      backend: "arcee-api",
      id: "trinity-large-thinking",
      endpoint: "https://api.arcee.ai/api/v1",
      display_name: "Managed Arcee",
    },
  } as ManagedHostStatus);
  vi.spyOn(api, "getSession").mockResolvedValue({
    metadata: {
      ...initial,
      agents_md_status: "loaded",
      cwd: "/workspace",
      sandbox_status: "disabled",
      store_path: "/state/nac.sqlite3",
    },
    messages: [],
    message_created_at: [],
    message_page: { start: 0, end: 0, total: 0, has_older: false },
  } as unknown as SessionSnapshotResponse);
  vi.spyOn(api, "listSessions").mockResolvedValue([
    {
      summary: {
        session_id: "settings-session",
        project_id: projectId,
        title: "Settings session",
        pinned: false,
        presentation_version: 1,
        backend: initial.backend,
        model: initial.model,
        cwd: "/workspace",
        created_at: "2026-09-08T00:00:00Z",
        updated_at: "2026-09-08T00:00:00Z",
        last_user_prompt: null,
        sandboxed: false,
        ssh_host: null,
        visible_message_count: 0,
      },
    } as ManagedSessionSummary,
  ]);
  vi.spyOn(api, "getConfig").mockResolvedValue({
    session_id: "settings-session",
    config_version: 1,
    ...initial,
    extra_headers_json: headersJson,
    light_model: lightModel,
    orchestrator_compaction_threshold: threshold,
    diagnostics,
  } as RawSessionConfig);
  vi.spyOn(api, "getModelCatalog").mockResolvedValue({
    catalog_version: 1,
    providers: [
      {
        id: "openai-responses",
        auth: "api_key_env",
        auth_status: "no_credential",
        auth_hint: null,
        connection: null,
        default_base_url: "https://api.openai.com/v1",
        managed_base_url: null,
        default_limits: { context_window: 1000, max_tokens: 100, supported_efforts: [] },
        models: [
          {
            id: "gpt-5.2",
            display_name: "GPT-5.2",
            context_window: 1000,
            max_tokens: 100,
            cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
            reasoning: true,
            supported_efforts: [],
            source: "baseline",
          },
        ],
      },
    ],
  } as ModelCatalog);
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <UiPolicyContext.Provider value={orchestration ? ORCHESTRATION_UI_POLICY : DIRECT_UI_POLICY}>
        <ToastProvider>
          <MemoryRouter>
            <SettingsModal open id="settings-session" onClose={vi.fn()} />
          </MemoryRouter>
        </ToastProvider>
      </UiPolicyContext.Provider>
    </QueryClientProvider>,
  );
  return { client, update, view };
}

it("holds a fast settings submit until managed status authorizes the mounted model", async () => {
  const status = Promise.withResolvers<ManagedHostStatus>();
  const initial = {
    backend: "arcee-api",
    model: "trinity-large-thinking",
    base_url: "https://api.arcee.ai/api/v1",
    allow_insecure_http: false,
    api_key_env: null,
    reasoning_effort: null,
    extra_headers: {},
  };
  vi.spyOn(api, "getManagedStatus").mockReturnValue(status.promise);
  vi.spyOn(api, "getSession").mockResolvedValue({
    metadata: {
      ...initial,
      agents_md_status: "loaded",
      cwd: "/workspace",
      sandbox_status: "disabled",
      store_path: "/state/nac.sqlite3",
    },
    messages: [],
    message_created_at: [],
    message_page: { start: 0, end: 0, total: 0, has_older: false },
  } as unknown as SessionSnapshotResponse);
  vi.spyOn(api, "listSessions").mockResolvedValue([
    {
      summary: {
        session_id: "managed-session",
        title: "Managed session",
        pinned: false,
        presentation_version: 1,
        backend: initial.backend,
        model: initial.model,
        cwd: "/workspace",
        created_at: "2026-09-08T00:00:00Z",
        updated_at: "2026-09-08T00:00:00Z",
        last_user_prompt: null,
        sandboxed: false,
        ssh_host: null,
        visible_message_count: 0,
      },
    } as ManagedSessionSummary,
  ]);
  vi.spyOn(api, "getConfig").mockResolvedValue({
    session_id: "managed-session",
    config_version: 1,
    ...initial,
    extra_headers_json: "{}",
    light_model: null,
    orchestrator_compaction_threshold: null,
    diagnostics: [],
  } as RawSessionConfig);
  vi.spyOn(api, "getModelCatalog").mockResolvedValue({
    catalog_version: 1,
    providers: [],
  } as ModelCatalog);
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <UiPolicyContext.Provider value={ORCHESTRATION_UI_POLICY}>
        <ToastProvider>
          <MemoryRouter>
            <SettingsModal open id="managed-session" onClose={onClose} />
          </MemoryRouter>
        </ToastProvider>
      </UiPolicyContext.Provider>
    </QueryClientProvider>,
  );

  try {
    fireEvent.click(await screen.findByRole("button", { name: "Choose Kimi" }));
    const save = screen.getByRole("button", { name: /^Save$/ });
    expect(save).toBeInstanceOf(HTMLButtonElement);
    if (!(save instanceof HTMLButtonElement)) throw new Error("Save button is missing");
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(update).not.toHaveBeenCalled();

    await act(async () => {
      status.resolve({
        model_ready: true,
        model: {
          backend: "arcee-api",
          id: initial.model,
          endpoint: initial.base_url,
          display_name: "Managed Arcee",
        },
      } as ManagedHostStatus);
    });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("managed-session", {
        model: "moonshotai/kimi-k3",
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  } finally {
    view.unmount();
    client.clear();
  }
});

it.each([
  ["numeric", "Select preset threshold 222", 222],
  ["disabled", "Select preset with compaction disabled", null],
] as const)(
  "applies an explicitly selected preset's %s compaction policy",
  async (_, label, expected) => {
    const { client, update, view } = renderReadySettings();
    try {
      fireEvent.click(await screen.findByRole("button", { name: label }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(update).toHaveBeenCalledWith("settings-session", {
          orchestrator_compaction_threshold: expected,
        }),
      );
    } finally {
      view.unmount();
      client.clear();
    }
  },
);

it("repairs malformed stored extra headers to an explicit empty object", async () => {
  const { client, update, view } = renderReadySettings({ headersJson: "{not-json}" });
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Keep current configuration" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("settings-session", {
        extra_headers: {},
      }),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it("saving direct settings keeps a hidden light model and disabled compaction intact", async () => {
  const { client, view, update } = renderReadySettings({
    orchestration: false,
    threshold: null,
    headersJson: "{not-json}",
    lightModel: { model: "gpt-5-mini", backend: "openai-responses", api_key_env: "OTHER_ACCOUNT" },
  });
  try {
    fireEvent.click(
      await screen.findByRole("button", { name: "Advanced presets and provider setup" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Keep current configuration" }));
    expect(screen.queryByText("Optional light model")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const patch = update.mock.calls[0]?.[1];
    expect(patch).not.toHaveProperty("light_model");
    expect(patch).not.toHaveProperty("orchestrator_compaction_threshold");
  } finally {
    view.unmount();
    client.clear();
  }
});

it("rejects a stale editor before creating a preset, saving configuration or renaming", async () => {
  const { client, update, view } = renderReadySettings();
  const title = vi
    .spyOn(api, "updatePresentation")
    .mockResolvedValue({} as Awaited<ReturnType<typeof api.updatePresentation>>);
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Select preset threshold 222" }));
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "New title" } });
    const initial = await vi.mocked(api.getConfig).mock.results[0]?.value;
    vi.mocked(api.getConfig).mockResolvedValue({
      ...initial,
      config_version: 2,
    } as RawSessionConfig);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/settings changed/);
    expect(update).not.toHaveBeenCalled();
    expect(title).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("keeps an unknown configuration outcome visible and disables retry through further edits", async () => {
  const { client, update, view } = renderReadySettings();
  update.mockRejectedValue(new TypeError("response lost"));
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Select preset threshold 222" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/outcome is unknown/);
    fireEvent.change(screen.getByLabelText("Session title"), {
      target: { value: "Edited after failure" },
    });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(update).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    client.clear();
  }
});

it("reports configuration saved but title rejected instead of closing with a false success", async () => {
  const { client, update, view } = renderReadySettings();
  vi.spyOn(api, "updatePresentation").mockRejectedValue(
    new ApiError(409, "PATCH", "/test", "presentation revision changed", "test-request"),
  );
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Select preset threshold 222" }));
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "New title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Chat settings were saved/);
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("updates a project default only after an explicit checkbox and the session save succeeds", async () => {
  const { client, update, view } = renderReadySettings({ projectId: "settings-project" });
  const project = vi
    .spyOn(api, "updateProject")
    .mockResolvedValue({ project_id: "settings-project" } as Awaited<
      ReturnType<typeof api.updateProject>
    >);
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Select preset threshold 222" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Use selected preset as the project default/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(project).toHaveBeenCalledExactlyOnceWith("settings-project", {
        default_model_config_id: "chosen-preset",
      }),
    );
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(project.mock.invocationCallOrder[0]!);
  } finally {
    view.unmount();
    client.clear();
  }
});

it("reports a project-default failure after the session save as partial progress and fences resubmission", async () => {
  const { client, update, view } = renderReadySettings({ projectId: "settings-project" });
  const project = vi.spyOn(api, "updateProject").mockRejectedValue(new TypeError("response lost"));
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Select preset threshold 222" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Use selected preset as the project default/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Chat settings were saved.*default save outcome is unknown/);
    expect(update).toHaveBeenCalledTimes(1);
    expect(project).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  } finally {
    view.unmount();
    client.clear();
  }
});

it("clears malformed hidden legacy light data only through the explicit Advanced repair", async () => {
  const { client, update, view } = renderReadySettings({
    orchestration: false,
    threshold: null,
    diagnostics: ["malformed stored light model: invalid JSON"],
  });
  try {
    fireEvent.click(
      await screen.findByRole("button", { name: "Advanced presets and provider setup" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Keep current configuration" }));
    fireEvent.click(screen.getByRole("button", { name: "Advanced Configurations" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Clear malformed legacy light settings" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("settings-session", { light_model: null }),
    );
    expect(screen.queryByText("Optional light model")).toBeNull();
  } finally {
    view.unmount();
    client.clear();
  }
});
