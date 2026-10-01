/** @vitest-environment jsdom */

import { UiPolicyContext } from "@/app/features/ui-policy/UiPolicyContext";
import { ORCHESTRATION_UI_POLICY, DIRECT_UI_POLICY } from "@/app/features/ui-policy/policy";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SettingsModal } from "@/app/components/modals/SettingsModal";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import type {
  BackendKind,
  ManagedHostStatus,
  ManagedSessionSummary,
  ModelCatalog,
  ModelConfigurationRecord,
  ProjectRecord,
  RawSessionConfig,
  SessionSnapshotResponse,
} from "@/app/types/api";

const openingPreset = {
  config_id: "matching-preset",
  name: "Opening preset",
  backend: "openai-responses" as const,
  model: "gpt-5.2",
  base_url: "https://api.openai.com/v1",
  allow_insecure_http: false,
  api_key_env: "OPENAI_API_KEY",
  reasoning_effort: "high" as const,
  extra_headers: {},
  orchestrator_compaction_threshold: 111,
  light_model: null,
  created_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
} satisfies ModelConfigurationRecord;

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
  providerBackend = "openai-responses",
}: {
  providerBackend?: BackendKind;
  diagnostics?: string[];
  projectId?: string | null;
  threshold?: number | null;
  headersJson?: string;
  orchestration?: boolean;
  lightModel?: RawSessionConfig["light_model"];
} = {}) {
  const initial = {
    backend: providerBackend,
    model: "gpt-5.2",
    base_url: "https://api.openai.com/v1",
    allow_insecure_http: false,
    api_key_env: providerBackend === "openai-responses" ? "OPENAI_API_KEY" : null,
    reasoning_effort: "high" as const,
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
        id: providerBackend,
        auth: "api_key_env",
        auth_status: "no_credential",
        auth_hint: null,
        connection: null,
        default_base_url: "https://api.openai.com/v1",
        managed_base_url: null,
        default_limits: { context_window: 1000, max_tokens: 100, supported_efforts: [] },
        models: [
          {
            id: "gpt-5.3",
            display_name: "GPT-5.3",
            context_window: 2000,
            max_tokens: 100,
            cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
            reasoning: true,
            supported_efforts: [],
            source: "baseline",
          },
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

it.each([false, true])(
  "retains edited headers/context across picker presentations (matching preset: %s)",
  async (matchingPreset) => {
    const record = openingPreset;
    vi.spyOn(api, "listModelConfigs").mockResolvedValue({
      configurations: matchingPreset ? [record] : [],
    });
    vi.spyOn(api, "resolveModelConfig").mockResolvedValue({
      ...record,
      models: [{ id: record.model, display_name: "GPT-5.2" }],
      models_error: null,
    });
    vi.spyOn(api, "listManagedAuth").mockResolvedValue({ providers: [] });
    const { client, update, view } = renderReadySettings({ orchestration: false });
    try {
      await waitFor(() =>
        expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      );
      fireEvent.click(screen.getByText("Advanced execution settings"));
      fireEvent.click(screen.getByRole("button", { name: "Advanced Configurations" }));
      fireEvent.change(document.querySelector("textarea")!, {
        target: { value: '{"X-Manual":"draft"}' },
      });
      fireEvent.change(screen.getByRole("textbox", { name: "Context limit" }), {
        target: { value: "444" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Advanced presets and provider setup" }));
      await waitFor(() =>
        expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      );
      await waitFor(() =>
        expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
          '{"X-Manual":"draft"}',
        ),
      );
      expect(
        (screen.getByRole("textbox", { name: "Context limit" }) as HTMLInputElement).value,
      ).toBe("444");
      fireEvent.click(screen.getByRole("button", { name: "Back to unified models" }));
      await waitFor(() =>
        expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      );
      expect(
        (screen.getByRole("textbox", { name: "Context limit" }) as HTMLInputElement).value,
      ).toBe("444");
      expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
        '{"X-Manual":"draft"}',
      );
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(update).toHaveBeenCalledExactlyOnceWith(
          "settings-session",
          expect.objectContaining({
            extra_headers: { "X-Manual": "draft" },
            orchestrator_compaction_threshold: 444,
          }),
        ),
      );
    } finally {
      view.unmount();
      client.clear();
    }
  },
);

it("can explicitly set an automatically matched full preset as the project default", async () => {
  vi.spyOn(api, "listModelConfigs").mockResolvedValue({ configurations: [openingPreset] });
  vi.spyOn(api, "resolveModelConfig").mockResolvedValue({
    ...openingPreset,
    models: [{ id: openingPreset.model, display_name: "GPT-5.2" }],
    models_error: null,
  });
  vi.spyOn(api, "listManagedAuth").mockResolvedValue({ providers: [] });
  const updateProject = vi.spyOn(api, "updateProject").mockResolvedValue({
    project_id: "project-1",
    default_model_config_id: "matching-preset",
  } as ProjectRecord);
  const { client, view } = renderReadySettings({ orchestration: false, projectId: "project-1" });
  try {
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Advanced presets and provider setup" }));
    await screen.findByText("Opening preset");
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /Use selected preset as the project default/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledExactlyOnceWith("project-1", {
        default_model_config_id: "matching-preset",
      }),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it.each([
  { threshold: 111, context: "444", headers: '{"X-Manual":"draft"}', orchestration: false },
  { threshold: null, context: "444", headers: '{"X-Manual":"draft"}', orchestration: false },
  { threshold: 111, context: "", headers: "", orchestration: true },
])(
  "keeps local Advanced edits when changing the primary model (%j)",
  async ({ threshold, context, headers, orchestration }) => {
    vi.spyOn(api, "listModelConfigs").mockResolvedValue({ configurations: [] });
    vi.spyOn(api, "listManagedAuth").mockResolvedValue({ providers: [] });
    const { client, update, view } = renderReadySettings({
      orchestration,
      threshold,
      headersJson: '{"X-Saved":"old"}',
      lightModel: orchestration
        ? {
            model: "gpt-5.2",
            backend: "openai-responses",
            base_url: "https://api.openai.com/v1",
            api_key_env: "OPENAI_API_KEY",
            reasoning_effort: "high",
          }
        : null,
    });
    try {
      await waitFor(() =>
        expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      );
      if (!orchestration) fireEvent.click(screen.getByText("Advanced execution settings"));
      fireEvent.click(screen.getByRole("button", { name: "Advanced Configurations" }));
      fireEvent.change(document.querySelector("textarea")!, { target: { value: headers } });
      fireEvent.change(screen.getByRole("textbox", { name: "Context limit" }), {
        target: { value: context },
      });
      if (orchestration) {
        fireEvent.click(screen.getByRole("button", { name: "Single" }));
        fireEvent.click(screen.getByRole("button", { name: "Back to unified models" }));
        expect(screen.getByRole("button", { name: "Single" }).getAttribute("aria-pressed")).toBe(
          "true",
        );
      }
      fireEvent.click(screen.getByRole("button", { name: /GPT-5.2/ }));
      fireEvent.click(await screen.findByText("GPT-5.3"));
      await waitFor(() => expect(screen.getByRole("button", { name: /GPT-5.3/ })).toBeTruthy());
      expect(
        (screen.getByRole("textbox", { name: "Context limit" }) as HTMLInputElement).value,
      ).toBe(context);
      expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe(headers);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(update).toHaveBeenCalledExactlyOnceWith(
          "settings-session",
          expect.objectContaining({
            model: "gpt-5.3",
            extra_headers: headers ? { "X-Manual": "draft" } : {},
            orchestrator_compaction_threshold: context ? Number(context) : null,
            ...(orchestration ? { light_model: null } : {}),
          }),
        ),
      );
    } finally {
      view.unmount();
      client.clear();
    }
  },
);

it.each(["chatgpt-codex-responses", "arcee-auth"] as const)(
  "saves title and context edits on an existing signed-out %s session",
  async (providerBackend) => {
    vi.spyOn(api, "listModelConfigs").mockResolvedValue({ configurations: [] });
    vi.spyOn(api, "listManagedAuth").mockResolvedValue({ providers: [] });
    const title = vi
      .spyOn(api, "updatePresentation")
      .mockResolvedValue({} as Awaited<ReturnType<typeof api.updatePresentation>>);
    const { client, update, view } = renderReadySettings({ orchestration: false, providerBackend });
    try {
      await waitFor(() =>
        expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      );
      fireEvent.change(screen.getByLabelText("Session title"), {
        target: { value: "Signed-out edit" },
      });
      fireEvent.click(screen.getByText("Advanced execution settings"));
      fireEvent.click(screen.getByRole("button", { name: "Advanced Configurations" }));
      fireEvent.change(screen.getByRole("textbox", { name: "Context limit" }), {
        target: { value: "444" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(update).toHaveBeenCalledExactlyOnceWith(
          "settings-session",
          expect.objectContaining({ orchestrator_compaction_threshold: 444 }),
        ),
      );
      expect(update.mock.calls[0][1]).not.toHaveProperty("backend");
      expect(update.mock.calls[0][1]).not.toHaveProperty("model");
      await waitFor(() => expect(title).toHaveBeenCalled());
    } finally {
      view.unmount();
      client.clear();
    }
  },
);
