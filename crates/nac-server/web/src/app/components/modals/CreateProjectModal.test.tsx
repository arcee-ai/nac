/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CreateProjectModal } from "@/app/components/modals/CreateProjectModal";
import { isolatedRegistry } from "@/app/effect/remote";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { apiEffect } from "@/app/services/api";
import { storeInfoAtom } from "@/app/services/queries/host";
import type {
  LightModelSettings,
  ModelCatalog,
  ProjectRecord,
  SessionSnapshotResponse,
  StoreInfo,
} from "@/app/types/api";

function spyResolved(method: string, value: unknown) {
  const target = apiEffect as unknown as Record<string, (...args: unknown[]) => unknown>;
  return vi
    .spyOn(target, method)
    .mockImplementation(() => Effect.promise(() => Promise.resolve(value)));
}

const createdSession = {
  metadata: { session_id: "first-session" },
  messages: [],
  message_created_at: [],
} as unknown as SessionSnapshotResponse;

let createSession: ReturnType<typeof spyResolved>;

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
  spyResolved("getStore", { root_cwd: "/workspace" } as StoreInfo);
  spyResolved("getModelCatalog", {
    catalog_version: 1,
    providers: [],
  } as ModelCatalog);
  spyResolved("createProject", {
    project_id: "created-project",
  } as ProjectRecord);
  createSession = spyResolved("createSession", createdSession);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderModal() {
  const registry = isolatedRegistry();
  registry.set(storeInfoAtom, AsyncResult.success({ root_cwd: "/workspace" } as StoreInfo));
  const view = render(
    <RegistryContext.Provider value={registry}>
      <ToastProvider>
        <MemoryRouter>
          <CreateProjectModal open onClose={vi.fn()} />
        </MemoryRouter>
      </ToastProvider>
    </RegistryContext.Provider>,
  );
  return { view };
}

it.each([
  ["numeric", "Select preset threshold 222", 222],
  ["disabled", "Select preset with compaction disabled", null],
] as const)(
  "launches with an explicitly selected preset's %s compaction policy",
  async (_, label, expected) => {
    const { view } = renderModal();
    try {
      fireEvent.click(await screen.findByRole("button", { name: label }));
      fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
      await waitFor(() => expect(createSession).toHaveBeenCalled());
      expect(createSession.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          orchestrator_compaction_threshold: expected,
        }),
      );
    } finally {
      view.unmount();
    }
  },
);

it("sends explicit null when the first chat changes a saved Dual preset to Single", async () => {
  const { view } = renderModal();
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Select dual preset" }));
    fireEvent.click(screen.getByRole("button", { name: "Use one model" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await waitFor(() => expect(createSession).toHaveBeenCalled());
    const request = createSession.mock.calls[0][0] as { light_model: unknown };
    expect(request.light_model).toBeNull();
  } finally {
    view.unmount();
  }
});
