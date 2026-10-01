/** @vitest-environment jsdom */

import { UiPolicyContext } from "@/app/features/ui-policy/UiPolicyContext";
import { ORCHESTRATION_UI_POLICY, DIRECT_UI_POLICY } from "@/app/features/ui-policy/policy";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CreateProjectModal } from "@/app/components/modals/CreateProjectModal";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api, ApiError } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import type {
  LightModelSettings,
  ModelCatalog,
  ProjectRecord,
  SessionSnapshotResponse,
  StoreInfo,
} from "@/app/types/api";

vi.mock("@/app/components/modals/ConfigurationsPanel", () => {
  const selection = (threshold: number | null, lightModel: LightModelSettings | null) => ({
    kind: "resolved",
    backend: "openai-responses",
    model: "gpt-5.2",
    base_url: "https://api.openai.com/v1",
    allow_insecure_http: false,
    api_key_env: "OPENAI_API_KEY",
    reasoning_effort: "high",
    extra_headers: { "X-Preset": "yes" },
    orchestrator_compaction_threshold: threshold,
    light_model: lightModel,
    config_id: "saved-preset",
  });
  return {
    ConfigurationsPanel: ({
      onChange,
      children,
    }: {
      onChange: (selection: Record<string, unknown>) => void;
      children?: import("react").ReactNode;
    }) => (
      <section>
        <button type="button" onClick={() => onChange(selection(222, null))}>
          Select preset threshold 222
        </button>
        <button type="button" onClick={() => onChange(selection(null, null))}>
          Select preset with compaction disabled
        </button>
        <button
          type="button"
          onClick={() =>
            onChange(
              selection(222, {
                backend: "openai-responses",
                model: "gpt-5-mini",
                base_url: "https://api.openai.com/v1",
                api_key_env: "OPENAI_API_KEY",
                reasoning_effort: "low",
              }),
            )
          }
        >
          Select dual preset
        </button>
        {children}
      </section>
    ),
  };
});

vi.mock("@/app/components/modals/PathPickerModal", () => ({
  PathPickerModal: ({ open, onSelect }: { open: boolean; onSelect: (path: string) => void }) =>
    open ? (
      <button onClick={() => onSelect("/workspace/new")}>Choose different folder</button>
    ) : null,
}));

vi.mock("@/app/components/modals/LightModelSection", async () => {
  const React = await import("react");
  return {
    LightModelSection: ({
      initial,
      onChange,
    }: {
      initial?: LightModelSettings | null;
      onChange: (selection: { mode: "single" | "dual"; light: LightModelSettings | null }) => void;
    }) => {
      React.useEffect(() => {
        onChange({ mode: initial ? "dual" : "single", light: initial ?? null });
      }, [initial, onChange]);
      return (
        <button type="button" onClick={() => onChange({ mode: "single", light: null })}>
          Use one model
        </button>
      );
    },
  };
});

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
  vi.spyOn(api, "getStore").mockResolvedValue({ root_cwd: "/workspace" } as StoreInfo);
  vi.spyOn(api, "getModelCatalog").mockResolvedValue({
    catalog_version: 1,
    providers: [],
  } as ModelCatalog);
  vi.spyOn(api, "createProject").mockResolvedValue({
    project_id: "created-project",
  } as ProjectRecord);
  vi.spyOn(api, "createSession").mockResolvedValue({
    metadata: { session_id: "first-session" },
    messages: [],
    message_created_at: [],
  } as unknown as SessionSnapshotResponse);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderModal(orchestration = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.storeInfo, { root_cwd: "/workspace" } as StoreInfo);
  const view = render(
    <QueryClientProvider client={client}>
      <UiPolicyContext.Provider value={orchestration ? ORCHESTRATION_UI_POLICY : DIRECT_UI_POLICY}>
        <ToastProvider>
          <MemoryRouter>
            <CreateProjectModal open onClose={vi.fn()} />
          </MemoryRouter>
        </ToastProvider>
      </UiPolicyContext.Provider>
    </QueryClientProvider>,
  );
  return { client, view };
}

it.each([
  ["numeric", "Select preset threshold 222", 222],
  ["disabled", "Select preset with compaction disabled", null],
] as const)(
  "launches with an explicitly selected preset's %s compaction policy",
  async (_, label, expected) => {
    const { client, view } = renderModal();
    try {
      fireEvent.click(await screen.findByRole("button", { name: label }));
      fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
      await waitFor(() => expect(api.createSession).toHaveBeenCalled());
      expect(vi.mocked(api.createSession).mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          orchestrator_compaction_threshold: expected,
        }),
      );
    } finally {
      view.unmount();
      client.clear();
    }
  },
);

it("sends explicit null when the first chat changes a saved Dual preset to Single", async () => {
  const { client, view } = renderModal();
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Select dual preset" }));
    fireEvent.click(screen.getByRole("button", { name: "Use one model" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalled());
    expect(vi.mocked(api.createSession).mock.calls[0]?.[0].light_model).toBeNull();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("default project creation requests direct without clearing a hidden dual preset", async () => {
  const { client, view } = renderModal(false);
  try {
    expect(screen.queryByRole("radiogroup")).toBeNull();
    fireEvent.click(
      await screen.findByRole("button", { name: "Advanced presets and provider setup" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Select dual preset" }));
    expect(screen.queryByRole("button", { name: "Use one model" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalled());
    expect(vi.mocked(api.createSession).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        behavior: "direct",
        first_chat: true,
        first_chat_same_behavior: true,
        light_model: expect.objectContaining({ model: "gpt-5-mini" }),
      }),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it("allows a new folder after a known duplicate-project rejection without replaying admission", async () => {
  vi.mocked(api.createProject).mockRejectedValueOnce(
    new ApiError(409, "POST", "/projects", "A project already uses this folder", "duplicate"),
  );
  const { client, view } = renderModal(false);
  try {
    fireEvent.click(
      await screen.findByRole("button", { name: "Advanced presets and provider setup" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Select preset threshold 222" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await screen.findByText(/A project already uses this folder/);
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.createSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("/workspace"));
    fireEvent.click(screen.getByRole("button", { name: "Choose different folder" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create Project" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalledTimes(1));
    expect(api.createProject).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.createProject).mock.calls[1]?.[0]).toMatchObject({
      cwd: "/workspace/new",
    });
  } finally {
    view.unmount();
    client.clear();
  }
});
