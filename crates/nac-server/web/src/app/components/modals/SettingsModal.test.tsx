/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SettingsModal } from "@/app/components/modals/SettingsModal";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import type {
  ManagedHostStatus,
  ManagedSessionSummary,
  ModelCatalog,
  RawSessionConfig,
  SessionSnapshotResponse,
} from "@/app/types/api";

vi.mock("@/app/components/modals/ConfigurationsPanel", () => ({
  ConfigurationsPanel: ({
    onChange,
  }: {
    onChange: (selection: Record<string, unknown>) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange({
          kind: "resolved",
          backend: "arcee-api",
          model: "moonshotai/kimi-k3",
          base_url: "https://api.arcee.ai/api/v1",
          api_key_env: null,
          reasoning_effort: null,
          extra_headers: null,
          light_model: undefined,
        })
      }
    >
      Choose Kimi
    </button>
  ),
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

it("holds a fast settings submit until managed status authorizes the mounted model", async () => {
  const status = Promise.withResolvers<ManagedHostStatus>();
  const initial = {
    backend: "arcee-api",
    model: "trinity-large-thinking",
    base_url: "https://api.arcee.ai/api/v1",
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
      <ToastProvider>
        <MemoryRouter>
          <SettingsModal open id="managed-session" onClose={onClose} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );

  try {
    fireEvent.click(await screen.findByRole("button", { name: "Choose Kimi" }));
    const save = screen.getByRole("dialog").querySelector("button.btn-primary");
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
