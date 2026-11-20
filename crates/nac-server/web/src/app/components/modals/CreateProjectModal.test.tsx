/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CreateProjectModal } from "@/app/components/modals/CreateProjectModal";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api, ApiError } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import type {
  ModelCatalog,
  ProjectRecord,
  SessionSnapshotResponse,
  StoreInfo,
} from "@/app/types/api";

vi.mock("@/app/components/modals/PrimaryModelSection", () => ({
  PrimaryModelSection: ({
    onChange,
  }: {
    onChange: (selection: Record<string, unknown>) => void;
  }) => {
    const choose = (backend: string, model: string, base_url: string) =>
      onChange({
        kind: "resolved",
        backend,
        model,
        base_url,
        allow_insecure_http: false,
        api_key_env: backend === "chatgpt-codex-responses" ? null : "OPENAI_API_KEY",
        reasoning_effort: "medium",
        extra_headers: {},
      });
    return (
      <section>
        <button
          type="button"
          onClick={() =>
            choose("chatgpt-codex-responses", "gpt-6.1-sol", "https://chatgpt.com/backend-api")
          }
        >
          Select Codex model
        </button>
        <button
          type="button"
          onClick={() => choose("openai-responses", "gpt-5.2", "https://api.openai.com/v1")}
        >
          Choose model
        </button>
        <button
          type="button"
          onClick={() => choose("openai-responses", "gpt-5.3", "https://api.openai.com/v1")}
        >
          Change primary model
        </button>
      </section>
    );
  },
}));

vi.mock("@/app/components/modals/PathPickerModal", () => ({
  PathPickerModal: ({
    open,
    initialPath,
    onSelect,
  }: {
    open: boolean;
    initialPath: string;
    onSelect: (path: string) => void;
  }) =>
    open ? (
      <>
        <output data-testid="picker-initial-path">{initialPath}</output>
        <button onClick={() => onSelect("/workspace/new")}>Choose different folder</button>
        <button onClick={() => onSelect("/workspace/Project 日本語 ")}>
          Choose literal folder
        </button>
      </>
    ) : null,
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

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.storeInfo, { root_cwd: "/workspace" } as StoreInfo);
  const view = render(
    <QueryClientProvider client={client}>
      <>
        <ToastProvider>
          <MemoryRouter>
            <CreateProjectModal open onClose={vi.fn()} />
          </MemoryRouter>
        </ToastProvider>
      </>
    </QueryClientProvider>,
  );
  return { client, view };
}

it("leaves an untouched Codex suggestion automatic when creating the first chat", async () => {
  vi.mocked(api.getModelCatalog).mockResolvedValue({
    catalog_version: 1,
    providers: [
      {
        id: "chatgpt-codex-responses",
        default_limits: {
          context_window: 500000,
          max_tokens: 16000,
          supported_efforts: [],
          limits: { effective_input_tokens: 475000, automatic_compaction_threshold: 332500 },
        },
        models: [],
      },
    ],
  } as unknown as ModelCatalog);
  const { client, view } = renderModal();
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Select Codex model" }));
    await waitFor(() =>
      expect(document.querySelector<HTMLInputElement>('input[inputmode="numeric"]')?.value).toBe(
        "332500",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalled());
    expect(vi.mocked(api.createSession).mock.calls[0]?.[0]).not.toHaveProperty(
      "compaction_threshold",
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it("project creation uses the selected direct session model", async () => {
  const { client, view } = renderModal();
  try {
    expect(screen.queryByRole("radiogroup")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Choose model" }));
    expect(screen.queryByRole("button", { name: "Use one model" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalled());
    expect(vi.mocked(api.createSession).mock.calls[0]?.[0]).not.toHaveProperty("light_model");
    expect(vi.mocked(api.createSession).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        behavior: "direct",
        first_chat: true,
        first_chat_same_behavior: true,
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
  const { client, view } = renderModal();
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Choose model" }));
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

it("preserves an edited context limit when changing the session model", async () => {
  const { client, view } = renderModal();
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Choose model" }));
    const limit = document.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    fireEvent.change(limit, { target: { value: "777" } });
    fireEvent.click(screen.getByRole("button", { name: "Change primary model" }));
    expect(limit.value).toBe("777");
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalled());
    expect(vi.mocked(api.createSession).mock.calls[0]?.[0]).toMatchObject({
      model: "gpt-5.3",
      compaction_threshold: 777,
    });
  } finally {
    view.unmount();
    client.clear();
  }
});

vi.mock("@/app/components/modals/SshConnectionBox", () => ({
  SshConnectionBox: ({
    onConnectionChange,
  }: {
    onConnectionChange: (
      target: { ssh_host: string; ssh_port: null; ssh_identity_file: null },
      home: string,
    ) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onConnectionChange(
          { ssh_host: "literal-build-alias", ssh_port: null, ssh_identity_file: null },
          "/home/fixture/workspace",
        )
      }
    >
      Connect fixture SSH
    </button>
  ),
}));

it("launches once through the connected SSH project without restating location or adding a sandbox", async () => {
  const { client, view } = renderModal();
  try {
    fireEvent.click(screen.getByRole("button", { name: "SSH" }));
    expect(api.createProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Connect fixture SSH" }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose model" }));
    const launch = screen.getByRole("button", { name: "Create Project" });
    fireEvent.click(launch);
    fireEvent.click(launch);
    await waitFor(() => expect(api.createSession).toHaveBeenCalledTimes(1));
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.createProject).mock.calls[0]?.[0]).toMatchObject({
      cwd: "/home/fixture/workspace",
      ssh_host: "literal-build-alias",
      ssh_port: null,
      ssh_identity_file: null,
    });
    const request = vi.mocked(api.createSession).mock.calls[0]?.[0];
    expect(request).toMatchObject({
      project_id: "created-project",
      behavior: "direct",
      model: "gpt-5.2",
    });
    expect(request).not.toHaveProperty("sandbox");
    expect(request).not.toHaveProperty("cwd");
    expect(request).not.toHaveProperty("ssh_host");
  } finally {
    view.unmount();
    client.clear();
  }
});

it("reopens and submits the exact selected local folder with trailing whitespace", async () => {
  const { client, view } = renderModal();
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Choose model" }));
    fireEvent.click(screen.getByText("/workspace"));
    fireEvent.click(screen.getByRole("button", { name: "Choose literal folder" }));
    fireEvent.click(screen.getByText("/workspace/Project 日本語", { exact: false }));
    expect(screen.getByTestId("picker-initial-path").textContent).toBe(
      "/workspace/Project 日本語 ",
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose literal folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalledOnce());
    expect(vi.mocked(api.createProject).mock.calls[0]?.[0]).toMatchObject({
      cwd: "/workspace/Project 日本語 ",
    });
  } finally {
    view.unmount();
    client.clear();
  }
});
