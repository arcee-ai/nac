/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { CreateProjectModal } from "./CreateProjectModal";
import { UiPolicyContext } from "@/app/features/ui-policy/UiPolicyContext";
import { DIRECT_UI_POLICY } from "@/app/features/ui-policy/policy";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import type {
  ModelCatalog,
  ModelConfigurationRecord,
  ProjectRecord,
  SessionSnapshotResponse,
  StoreInfo,
} from "@/app/types/api";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps a catalog project default unset when Advanced discovers a partial matching preset", async () => {
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
  const record = {
    config_id: "different-advanced-tuple",
    name: "Different Advanced tuple",
    backend: "openai-responses" as const,
    model: "gpt-5.2",
    base_url: "https://api.openai.com/v1",
    allow_insecure_http: false,
    api_key_env: "OPENAI_API_KEY",
    reasoning_effort: null,
    extra_headers: {},
    orchestrator_compaction_threshold: 222,
    light_model: { model: "saved-light" },
    created_at: "today",
    updated_at: "today",
  } satisfies ModelConfigurationRecord;
  vi.spyOn(api, "getStore").mockResolvedValue({ root_cwd: "/workspace" } as StoreInfo);
  vi.spyOn(api, "getManagedStatus").mockRejectedValue(new Error("unmanaged host"));
  vi.spyOn(api, "listProviderModels").mockResolvedValue({
    base_url: record.base_url,
    models: [{ id: record.model, display_name: "GPT-5.2" }],
  });
  vi.spyOn(api, "listManagedAuth").mockResolvedValue({ providers: [] });
  vi.spyOn(api, "listModelConfigs").mockResolvedValue({ configurations: [] });
  vi.spyOn(api, "resolveModelConfig").mockResolvedValue({
    ...record,
    models: [{ id: record.model, display_name: "GPT-5.2" }],
    models_error: null,
  });
  vi.spyOn(api, "getModelCatalog").mockResolvedValue({
    catalog_version: 1,
    providers: [
      {
        id: record.backend,
        auth: "api_key_env",
        auth_status: "ready",
        auth_hint: null,
        connection: { base_url: record.base_url, api_key_env: record.api_key_env },
        default_base_url: record.base_url,
        managed_base_url: null,
        default_limits: { context_window: 1000, max_tokens: 100, supported_efforts: [] },
        models: [
          {
            id: record.model,
            display_name: "GPT-5.2",
            context_window: 1000,
            max_tokens: 100,
            cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
            reasoning: false,
            supported_efforts: [],
            source: "baseline",
          },
        ],
      },
    ],
  } as ModelCatalog);
  const project = vi
    .spyOn(api, "createProject")
    .mockResolvedValue({ project_id: "created-project" } as ProjectRecord);
  vi.spyOn(api, "createSession").mockResolvedValue({
    metadata: { session_id: "first-session" },
    messages: [],
    message_created_at: [],
  } as unknown as SessionSnapshotResponse);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.storeInfo, { root_cwd: "/workspace" });
  const view = render(
    <QueryClientProvider client={client}>
      <UiPolicyContext.Provider value={DIRECT_UI_POLICY}>
        <ToastProvider>
          <MemoryRouter>
            <CreateProjectModal open onClose={vi.fn()} />
          </MemoryRouter>
        </ToastProvider>
      </UiPolicyContext.Provider>
    </QueryClientProvider>,
  );
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Select a model" }));
    fireEvent.click(await screen.findByText("GPT-5.2", { exact: true }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create Project" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Advanced presets and provider setup" }));
    await screen.findByRole("button", { name: "Create New" });
    await act(async () => {
      client.setQueryData(queryKeys.modelConfigs, { configurations: [record] });
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create Project" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await waitFor(() => expect(project).toHaveBeenCalled());
    expect(project.mock.calls[0][0]).toMatchObject({ default_model_config_id: null });
    expect(screen.getByRole("button", { name: "Create New" })).toBeTruthy();
  } finally {
    view.unmount();
    client.clear();
  }
});
