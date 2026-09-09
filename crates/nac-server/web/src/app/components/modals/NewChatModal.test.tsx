/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { NewChatModal } from "@/app/components/modals/NewChatModal";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import type {
  LightModelSettings,
  ModelConfigurationRecord,
  ProjectRecord,
  SessionSnapshotResponse,
} from "@/app/types/api";

vi.mock("@/app/components/modals/ConfigurationsPanel", async () => {
  const React = await import("react");
  return {
    ConfigurationsPanel: ({
      initial,
      onChange,
      children,
    }: {
      initial?: {
        backend: string;
        model: string;
        base_url: string;
        api_key_env: string | null;
        reasoning_effort: string | null;
        extra_headers: Record<string, string>;
      };
      onChange: (selection: Record<string, unknown> | null) => void;
      children?: React.ReactNode;
    }) => {
      React.useEffect(() => {
        onChange(
          initial
            ? {
                kind: "resolved",
                ...initial,
                light_model: undefined,
              }
            : null,
        );
      }, [initial, onChange]);
      return (
        <section>
          <p>Primary model: {initial?.model ?? "none"}</p>
          {children}
        </section>
      );
    },
  };
});

vi.mock("@/app/components/modals/LightModelSection", async () => {
  const React = await import("react");
  return {
    LightModelSection: ({
      initial,
      behavior,
      onChange,
    }: {
      initial?: LightModelSettings | null;
      behavior?: string;
      onChange: (selection: { mode: "single" | "dual"; light: LightModelSettings | null }) => void;
    }) => {
      React.useEffect(() => {
        onChange({ mode: initial ? "dual" : "single", light: initial ?? null });
      }, [initial, onChange]);
      return (
        <div>
          <p>
            Light model for {behavior}: {initial?.model ?? "none"}
          </p>
          <button type="button" onClick={() => onChange({ mode: "single", light: null })}>
            Use one model
          </button>
        </div>
      );
    },
  };
});

vi.mock("@/app/components/modals/PrimaryModelSection", async () => {
  const React = await import("react");
  return {
    PrimaryModelSection: ({
      initial,
      onChange,
    }: {
      initial?: {
        backend: string;
        model: string;
        base_url: string;
        api_key_env: string | null;
        reasoning_effort: string | null;
        extra_headers: Record<string, string>;
      };
      onChange: (selection: Record<string, unknown> | null) => void;
    }) => {
      React.useEffect(() => {
        onChange(initial ? { kind: "resolved", ...initial, light_model: undefined } : null);
      }, [initial, onChange]);
      return <p>Primary model: {initial?.model ?? "none"}</p>;
    },
  };
});

const light: LightModelSettings = {
  model: "gpt-5-mini",
  backend: "openai-responses",
  base_url: "https://api.openai.com/v1",
  api_key_env: "OPENAI_API_KEY",
  reasoning_effort: "low",
};

const configuration = {
  config_id: "project-default",
  name: "Project default",
  backend: "openai-responses",
  model: "gpt-5.6-sol",
  base_url: "https://api.openai.com/v1",
  api_key_env: "OPENAI_API_KEY",
  reasoning_effort: "high",
  extra_headers: { "X-Test": "yes" },
  light_model: light,
  orchestrator_compaction_threshold: null,
  initial_prompt: null,
  created_at: "2026-09-08T00:00:00Z",
  updated_at: "2026-09-08T00:00:00Z",
} as ModelConfigurationRecord;

const project = {
  project_id: "project",
  name: "Project",
  description: null,
  cwd: "/workspace",
  ssh_host: null,
  ssh_port: null,
  ssh_identity_file: null,
  default_model_config_id: configuration.config_id,
  pinned: false,
  sort_order: 0,
  presentation_version: 0,
  created_at: "2026-09-08T00:00:00Z",
  updated_at: "2026-09-08T00:00:00Z",
} as ProjectRecord;

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
  vi.spyOn(api, "listProjects").mockResolvedValue({ projects: [project] });
  vi.spyOn(api, "listSessions").mockResolvedValue([]);
  vi.spyOn(api, "listModelConfigs").mockResolvedValue({ configurations: [configuration] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <NewChatModal projectId="project" onClose={vi.fn()} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { client, view };
}

it("shows and preserves the inherited primary and light models for a direct chat", async () => {
  const create = vi.spyOn(api, "createSession").mockResolvedValue({
    metadata: { session_id: "direct-chat" },
    messages: [],
    message_created_at: [],
  } as unknown as SessionSnapshotResponse);
  const { client, view } = renderModal();

  try {
    expect(await screen.findByText("Primary model: gpt-5.6-sol")).toBeTruthy();
    expect(screen.getByText("Light model for orchestrator: gpt-5-mini")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /^Direct coding agent / }));
    expect(screen.getByText("Light model for direct: gpt-5-mini")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create chat" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        project_id: "project",
        behavior: "direct",
        first_chat: false,
        backend: "openai-responses",
        model: "gpt-5.6-sol",
        base_url: "https://api.openai.com/v1",
        api_key_env: "OPENAI_API_KEY",
        reasoning_effort: "high",
        extra_headers: { "X-Test": "yes" },
        light_model: light,
      }),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it("sends null when one chat clears an inherited light model", async () => {
  const create = vi.spyOn(api, "createSession").mockResolvedValue({
    metadata: { session_id: "single-chat" },
    messages: [],
    message_created_at: [],
  } as unknown as SessionSnapshotResponse);
  const { client, view } = renderModal();

  try {
    await screen.findByText("Light model for orchestrator: gpt-5-mini");
    fireEvent.click(screen.getByRole("button", { name: "Use one model" }));
    fireEvent.click(screen.getByRole("button", { name: "Create chat" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]?.[0].light_model).toBeNull();
  } finally {
    view.unmount();
    client.clear();
  }
});
