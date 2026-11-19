/** @vitest-environment jsdom */

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
  RawSessionConfig,
  SessionSnapshotResponse,
} from "@/app/types/api";

const resizeObserved = vi.fn();
const resizeDisconnected = vi.fn();

beforeEach(() => {
  resizeObserved.mockClear();
  resizeDisconnected.mockClear();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = resizeObserved;
      disconnect = resizeDisconnected;
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
  orchestration: _orchestration = true,
  projectId = null,
  diagnostics = [],
  providerBackend = "openai-responses",
  automaticCompaction = false,
}: {
  automaticCompaction?: boolean;
  providerBackend?: BackendKind;
  diagnostics?: string[];
  projectId?: string | null;
  threshold?: number | null;
  headersJson?: string;
  orchestration?: boolean;
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
    orchestrator_compaction_threshold: threshold,
    automatic_compaction: automaticCompaction,
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
      <>
        <ToastProvider>
          <MemoryRouter>
            <SettingsModal open id="settings-session" onClose={vi.fn()} />
          </MemoryRouter>
        </ToastProvider>
      </>
    </QueryClientProvider>,
  );
  return { client, update, view };
}

it("saves a manually edited automatic threshold even if restored to its original value", async () => {
  vi.spyOn(api, "listManagedAuth").mockResolvedValue({ providers: [] });
  const { client, update, view } = renderReadySettings({
    automaticCompaction: true,
    orchestration: false,
  });
  try {
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByText("Advanced execution settings"));
    fireEvent.click(screen.getByRole("button", { name: "Advanced Configurations" }));
    const limit = screen.getByRole("textbox", { name: "Context limit" }) as HTMLInputElement;
    const original = limit.value;
    fireEvent.change(limit, { target: { value: "123" } });
    fireEvent.change(limit, { target: { value: original } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      orchestrator_compaction_threshold: Number(original),
    });
  } finally {
    view.unmount();
    client.clear();
  }
});

it("names native headers and retains edits while opening provider connections", async () => {
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
    const dialog = screen.getByRole("dialog", { name: "Session settings" });
    const headers = () =>
      screen.getByRole("textbox", {
        name: "Extra headers (JSON object)",
      }) as HTMLTextAreaElement;
    expect(headers().tagName).toBe("TEXTAREA");
    expect(headers().closest('[role="dialog"]')).toBe(dialog);
    expect(screen.getByText(/^Extra headers$/)).toBeTruthy();
    expect(
      screen.getByText("Enter a JSON object with string values. Blank sends none.").tagName,
    ).toBe("P");
    const body = headers().closest(".paragraph-medium")!;
    expect(body).not.toBeNull();
    // matchMedia is desktop: flush cards scroll the outer wrapper, not this inner body.
    expect(resizeObserved.mock.calls.map(([target]) => target)).toContain(body.parentElement);
    expect(resizeObserved.mock.calls.map(([target]) => target)).toContain(body);
    fireEvent.change(headers(), {
      target: { value: '{"X-Manual":"draft"}' },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Context limit" }), {
      target: { value: "444" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Provider connections" }));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    await waitFor(() => expect(headers().value).toBe('{"X-Manual":"draft"}'));
    expect(headers().closest('[role="dialog"]')).toBe(dialog);
    expect(update).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "Context limit" }) as HTMLInputElement).value).toBe(
      "444",
    );
    fireEvent.click(screen.getByRole("button", { name: "Provider connections" }));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect((screen.getByRole("textbox", { name: "Context limit" }) as HTMLInputElement).value).toBe(
      "444",
    );
    expect(headers().value).toBe('{"X-Manual":"draft"}');
    expect(headers().closest('[role="dialog"]')).toBe(dialog);
    expect(update).not.toHaveBeenCalled();
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
    expect(resizeDisconnected).toHaveBeenCalled();
    client.clear();
  }
});

it.each([
  { threshold: 111, context: "444", headers: '{"X-Manual":"draft"}', orchestration: false },
  { threshold: null, context: "444", headers: '{"X-Manual":"draft"}', orchestration: false },
  { threshold: 111, context: "", headers: "", orchestration: false },
])(
  "keeps local Advanced edits when changing the primary model (%j)",
  async ({ threshold, context, headers, orchestration }) => {
    vi.spyOn(api, "listManagedAuth").mockResolvedValue({ providers: [] });
    const { client, update, view } = renderReadySettings({
      orchestration,
      threshold,
      headersJson: '{"X-Saved":"old"}',
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
