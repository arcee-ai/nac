/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

import { HomeComposer } from "./HomeComposer";
import { standaloneHomeDraftStore } from "./homeDraftStore";

const fakes = vi.hoisted(() => ({
  start: vi.fn(),
  create: vi.fn(),
  addRepository: vi.fn(),
  managed: false,
  managedModelReady: false,
  providersReady: true,
  eligible: false,
  sandboxStatus: "ready" as "ready" | "missing",
  sandboxProbe: vi.fn(),
  inheritedPending: false,
  inheritedError: null as Error | null,
  configuredModel: null as string | null,
  inheritedEffort: "high" as string | null,
  inheritedModel: "glm-5",
  nativeSpeed: undefined as "fast" | "standard" | undefined,
  sourceConfig: null as Record<string, unknown> | null,
}));

vi.mock("@tanstack/react-query", async (original) => {
  const actual = await original<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: { queryKey: readonly unknown[] }) => {
      if (options.queryKey[0] !== "project-session-model-source")
        return actual.useQuery(options as never);
      return {
        data: fakes.sourceConfig,
        isSuccess: Boolean(fakes.sourceConfig),
        isPending: false,
        isFetching: false,
        isError: !fakes.sourceConfig,
      };
    },
  };
});
vi.mock("./useStartSession", () => ({
  useStartSession: () => ({
    start: fakes.start,
    busy: false,
    needsReview: false,
    error: null,
    clearError: vi.fn(),
  }),
}));
vi.mock("@/app/services/queries", () => ({
  useSandboxAvailability: (enabled: boolean) => {
    fakes.sandboxProbe(enabled);
    return {
      data: enabled
        ? {
            status: fakes.sandboxStatus,
            guidance: fakes.sandboxStatus === "missing" ? "Install Podman to continue." : null,
          }
        : undefined,
      isFetching: false,
      isPending: !enabled,
      isError: false,
      refetch: vi.fn(),
    };
  },
  useModelCatalog: () => ({
    data: {
      providers: [
        {
          id: "arcee-api",
          auth_status: fakes.providersReady ? "ready" : "missing",
          default_base_url: "https://api.arcee.ai/v1",
          models: [
            {
              id: "glm-5",
              cost: { input: 0, output: 0 },
              supported_efforts: ["low", "medium", "high"],
            },
          ],
          default_limits: { supported_efforts: [] },
        },
        {
          id: "openai-chat-completions",
          auth_status: fakes.providersReady ? "ready" : "missing",
          default_base_url: "https://api.openai.com/v1",
          models: [
            {
              id: "gpt-6.1-sol",
              cost: { input: 0, output: 0 },
              supported_efforts: ["low", "high"],
            },
          ],
          default_limits: { supported_efforts: [] },
          speed_profiles: { "gpt-6.1-sol": { tiers: ["standard", "fast"] } },
        },
      ],
    },
    isPending: false,
    isError: false,
  }),
  useReadyProviderModels: () => new Map(),
}));
vi.mock("@/app/features/task-launches/useTaskLaunch", () => ({
  useTaskLaunchSource: (_id: string | null, enabled: boolean) => ({
    data: enabled ? { eligible: fakes.eligible, default_ref: "main" } : undefined,
  }),
}));
vi.mock("@/app/features/task-launches/TaskLaunchModal", () => ({
  TaskLaunchModal: ({
    initialPrompt,
    initialGitRef,
    onExistingCheckout,
  }: {
    initialPrompt: string;
    initialGitRef: string;
    onExistingCheckout: (text: string) => void;
  }) => (
    <div role="dialog" aria-label="New isolated task" data-ref={initialGitRef}>
      {initialPrompt}
      <button onClick={() => onExistingCheckout("Edited task brief")}>Use existing checkout</button>
    </div>
  ),
}));
vi.mock("@/app/features/managed/controller/useManagedHost", () => ({
  useManagedHost: () => ({
    status: fakes.managed ? { model_ready: fakes.managedModelReady } : null,
    isManaged: fakes.managed,
    isUnmanaged: !fakes.managed,
    addRepository: fakes.addRepository,
  }),
}));
vi.mock("@/app/providers/ProjectActionsProvider", () => ({
  useProjectActions: () => ({ create: fakes.create }),
}));

const projects = [
  { project_id: "p1", name: "Atlas", cwd: "/atlas", pinned: false },
  { project_id: "p2", name: "Borealis", cwd: "/borealis", pinned: false },
] as ProjectRecord[];

// SAFETY: only project identity and activity time are read here.
const sessions = [
  {
    summary: {
      session_id: "s",
      project_id: "p2",
      updated_at: "2026-11-16T10:00:00Z",
    },
  },
] as ManagedSessionSummary[];

function mount(
  path = "/",
  _orchestration = true,
  list: readonly ProjectRecord[] = projects,
  sessionList: readonly ManagedSessionSummary[] = sessions,
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HomeComposer projects={list} sessions={sessionList} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  fakes.start.mockReset().mockResolvedValue(true);
  fakes.create.mockReset();
  fakes.addRepository.mockReset();
  fakes.managed = false;
  fakes.managedModelReady = false;
  fakes.providersReady = true;
  fakes.eligible = false;
  fakes.sandboxStatus = "ready";
  fakes.sandboxProbe.mockClear();
  fakes.inheritedPending = false;
  fakes.inheritedError = null;
  fakes.configuredModel = null;
  fakes.inheritedEffort = "high";
  fakes.inheritedModel = "glm-5";
  fakes.nativeSpeed = undefined;
  fakes.sourceConfig = null;
  standaloneHomeDraftStore.update("", null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function prompt() {
  return screen.getByRole("textbox", { name: "What should we work on?" });
}

function chooseModel(name = /glm-5/i) {
  fireEvent.click(screen.getByRole("button", { name: /^(Choose a model|Model: )/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Choose model/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
}

describe("Sandbox launch", () => {
  it("checks Podman only after selecting Sandbox and submits the chosen options", async () => {
    fakes.eligible = true;
    mount("/", false);
    chooseModel();
    fireEvent.change(prompt(), { target: { value: "Run in the container" } });
    fireEvent.click(screen.getByRole("button", { name: "Additional settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Isolated checkout" }));
    expect(fakes.sandboxProbe).not.toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("switch", { name: "Sandbox" }));
    expect(fakes.sandboxProbe).toHaveBeenCalledWith(true);
    expect(screen.getByRole("switch", { name: "Isolated checkout", checked: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sandbox options" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Container image" }), {
      target: { value: "alpine" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Container workdir" }), {
      target: { value: "/work" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Additional mounts" }), {
      target: { value: "/cache:/cache" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Don’t mount the working folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Additional settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Start sandbox session" }));
    await vi.waitFor(() => expect(fakes.start).toHaveBeenCalledOnce());
    expect(fakes.start).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p2",
        sandbox: expect.objectContaining({
          image: "alpine",
          workdir: "/work",
          mounts: "/cache:/cache",
          noMount: true,
        }),
      }),
    );
  });

  it("keeps the draft when Podman is missing and only starts Locally after explicit deselection", async () => {
    fakes.sandboxStatus = "missing";
    mount("/", false);
    chooseModel();
    fireEvent.change(prompt(), { target: { value: "Do not run Locally" } });
    fireEvent.click(screen.getByRole("button", { name: "Additional settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Sandbox" }));
    expect(screen.getByText("Install Podman to continue.")).toBeTruthy();
    fireEvent.keyDown(prompt(), { key: "Enter" });
    expect(fakes.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "Sandbox" }));
    fireEvent.keyDown(prompt(), { key: "Enter" });
    await vi.waitFor(() => expect(fakes.start).toHaveBeenCalledOnce());
    expect(fakes.start.mock.calls[0]?.[0]).not.toHaveProperty("sandbox");
  });

  it("does not send on a different project when the selected sandbox project disappears", () => {
    const view = mount("/", false);
    fireEvent.change(prompt(), {
      target: { value: "Stay in the selected sandbox" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Additional settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Sandbox" }));
    view.rerender(
      <MemoryRouter initialEntries={["/"]}>
        <HomeComposer projects={projects.slice(0, 1)} sessions={sessions} />
      </MemoryRouter>,
    );
    fireEvent.keyDown(prompt(), { key: "Enter" });
    expect(fakes.start).not.toHaveBeenCalled();
    expect((prompt() as HTMLTextAreaElement).value).toBe("Stay in the selected sandbox");
    expect((prompt() as HTMLTextAreaElement).placeholder).toMatch(
      /project is no longer available/i,
    );
  });

  it.each(["managed", "ssh"])("omits Sandbox on %s projects", (mode) => {
    fakes.managed = mode === "managed";
    mount(
      "/?project=p2",
      false,
      mode === "ssh" ? [projects[0]!, { ...projects[1]!, ssh_host: "build-box" }] : projects,
    );
    fireEvent.click(screen.getByRole("button", { name: "Additional settings" }));
    expect(screen.queryByRole("switch", { name: "Sandbox" })).toBeNull();
    expect(fakes.sandboxProbe).not.toHaveBeenCalledWith(true);
  });
});

it("offers Accounts reconnect when no provider is ready", () => {
  fakes.providersReady = false;
  mount("/?project=p1");
  expect(screen.getByRole("button", { name: "Connect a provider" })).toBeTruthy();
  fireEvent.change(prompt(), { target: { value: "Start" } });
  expect(
    (screen.getByRole("button", { name: "Start session" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it("does not replace a failed source config with a different suggestion", () => {
  const source = [
    {
      summary: {
        session_id: "source",
        project_id: "p2",
        cwd: "/borealis",
        ssh_host: null,
        sandboxed: false,
        created_at: "2026-11-16T10:00:00Z",
        updated_at: "2026-11-16T10:00:00Z",
        backend: "openai-responses",
      },
    },
  ] as ManagedSessionSummary[];
  fakes.sourceConfig = null;
  mount("/?project=p2", true, projects, source);
  expect(screen.getByRole("button", { name: "Choose a model" })).toBeTruthy();
  fireEvent.change(prompt(), { target: { value: "Start" } });
  expect(
    (screen.getByRole("button", { name: "Start session" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it("keeps the model picker available while a managed mounted model is ready", () => {
  fakes.managed = true;
  fakes.managedModelReady = true;
  fakes.providersReady = false;
  mount("/?project=p1");
  expect(screen.getByRole("button", { name: "Choose a model" })).toBeTruthy();
  expect(screen.queryByText("Connect a provider")).toBeNull();
});

const savedSource = [
  {
    summary: {
      session_id: "source",
      project_id: "p2",
      cwd: "/borealis",
      ssh_host: null,
      sandboxed: false,
      created_at: "2026-11-16T10:00:00Z",
      updated_at: "2026-11-16T10:00:00Z",
      backend: "openai-chat-completions",
    },
  },
] as ManagedSessionSummary[];
const savedConfig = {
  session_id: "source",
  backend: "openai-chat-completions",
  model: "gpt-6.1-sol",
  base_url: "https://api.openai.com/v1",
  allow_insecure_http: false,
  api_key_env: "OPENAI_API_KEY",
  reasoning_effort: null,
  service_tier: null,
  config_version: 7,
};

it("shows and sends the session-layer suggested effort when the source has none", async () => {
  fakes.sourceConfig = savedConfig;
  mount("/?project=p2", true, projects, savedSource);
  expect(screen.getByRole("button", { name: /Low reasoning/ })).toBeTruthy();
  fireEvent.change(prompt(), { target: { value: "Continue" } });
  fireEvent.click(screen.getByRole("button", { name: "Start session" }));
  await vi.waitFor(() => expect(fakes.start).toHaveBeenCalledOnce());
  expect(fakes.start.mock.calls[0]?.[0].model.selection.reasoning_effort).toBe("low");
});

it("does not carry a preferred source into another selected project", async () => {
  fakes.sourceConfig = savedConfig;
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: "/",
          search: "?project=p2",
          state: { sourceSessionId: "source", sourceProjectId: "p2" },
        },
      ]}
    >
      <HomeComposer projects={projects} sessions={savedSource} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: /Model:.*gpt-6.1-sol/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Project: Borealis" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /Atlas/ }));
  expect(screen.getByRole("button", { name: /Model:.*glm-5/ })).toBeTruthy();
  fireEvent.change(prompt(), { target: { value: "Continue in Atlas" } });
  fireEvent.click(screen.getByRole("button", { name: "Start session" }));
  await vi.waitFor(() => expect(fakes.start).toHaveBeenCalledOnce());
  expect(fakes.start.mock.calls[0]?.[0]).toMatchObject({
    projectId: "p1",
    model: { selection: { backend: "arcee-api", model: "glm-5" } },
  });
});

it("replaces a sourced route when the same model is chosen at a different endpoint", async () => {
  fakes.sourceConfig = {
    ...savedConfig,
    base_url: "http://old.invalid/v1",
    allow_insecure_http: true,
    api_key_env: "OLD_KEY",
  };
  mount("/?project=p2", true, projects, savedSource);
  fireEvent.click(screen.getByRole("button", { name: /^Model: / }));
  fireEvent.click(screen.getByRole("button", { name: /^Choose model/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /gpt-6.1-sol/i }));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  fireEvent.change(prompt(), { target: { value: "Continue" } });
  fireEvent.click(screen.getByRole("button", { name: "Start session" }));
  await vi.waitFor(() => expect(fakes.start).toHaveBeenCalledOnce());
  expect(fakes.start.mock.calls[0]?.[0].model.selection).toMatchObject({
    base_url: "https://api.openai.com/v1",
    allow_insecure_http: false,
    api_key_env: null,
  });
  expect(fakes.start.mock.calls[0]?.[0].model.source).toBeUndefined();
});

it("does not copy a source credential when the same route now has a different selector", async () => {
  fakes.sourceConfig = savedConfig;
  mount("/?project=p2", true, projects, savedSource);
  fireEvent.click(screen.getByRole("button", { name: /^Model: / }));
  fireEvent.click(screen.getByRole("button", { name: /^Choose model/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /gpt-6.1-sol/i }));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  fireEvent.change(prompt(), { target: { value: "Continue" } });
  fireEvent.click(screen.getByRole("button", { name: "Start session" }));
  await vi.waitFor(() => expect(fakes.start).toHaveBeenCalledOnce());
  expect(fakes.start.mock.calls[0]?.[0].model.selection.api_key_env).toBeNull();
  expect(fakes.start.mock.calls[0]?.[0].model.source).toBeUndefined();
});

describe("source session model", () => {
  it.each([false, true])(
    "shows and explicitly submits the same-project session choice (phone: %s)",
    async (phone) => {
      vi.stubGlobal("matchMedia", () => ({
        matches: phone,
        addEventListener() {},
        removeEventListener() {},
      }));
      const source = [
        {
          summary: {
            session_id: "source",
            project_id: "p2",
            cwd: "/borealis",
            ssh_host: null,
            sandboxed: false,
            created_at: "2026-11-16T10:00:00Z",
            updated_at: "2026-11-16T10:00:00Z",
            backend: "openai-chat-completions",
          },
        },
      ] as ManagedSessionSummary[];
      fakes.sourceConfig = {
        session_id: "source",
        backend: "openai-chat-completions",
        model: "gpt-6.1-sol",
        base_url: "https://api.openai.com/v1",
        allow_insecure_http: false,
        api_key_env: "OPENAI_API_KEY",
        reasoning_effort: "high",
        service_tier: "fast",
        extra_headers_json: "{}",
      };
      mount("/?project=p2", true, projects, source);
      expect(screen.getByRole("button", { name: /Model:.*gpt-6.1-sol.*Fast speed/i })).toBeTruthy();
      fireEvent.change(prompt(), { target: { value: "Continue with the selected model" } });
      fireEvent.click(screen.getByRole("button", { name: "Start session" }));
      await vi.waitFor(() => expect(fakes.start).toHaveBeenCalledOnce());
      expect(fakes.start.mock.calls[0]?.[0]).toMatchObject({
        projectId: "p2",
        model: {
          selection: {
            backend: "openai-chat-completions",
            model: "gpt-6.1-sol",
            api_key_env: "OPENAI_API_KEY",
            reasoning_effort: "high",
            service_tier: "fast",
          },
        },
      });
    },
  );
});

describe("Home composer", () => {
  it("starts a session in the most recent project with the prompt as its first message", async () => {
    mount();
    chooseModel();
    expect(screen.getByRole("button", { name: "Project: Borealis" })).toBeTruthy();
    fireEvent.change(prompt(), { target: { value: "Fix the flaky test" } });
    fireEvent.keyDown(prompt(), { key: "Enter" });
    await vi.waitFor(() =>
      expect(fakes.start).toHaveBeenCalledWith({
        projectId: "p2",
        prompt: "Fix the flaky test",
        model: expect.objectContaining({
          selection: expect.objectContaining({ model: "glm-5" }),
        }),
      }),
    );
    await vi.waitFor(() => expect((prompt() as HTMLTextAreaElement).value).toBe(""));
  });

  it("points at the project named in the address and keeps Shift+Enter as a new line", () => {
    mount("/?project=p1");
    expect(screen.getByRole("button", { name: "Project: Atlas" })).toBeTruthy();
    expect(document.activeElement).toBe(prompt());
    fireEvent.change(prompt(), { target: { value: "Line one" } });
    fireEvent.keyDown(prompt(), { key: "Enter", shiftKey: true });
    expect(fakes.start).not.toHaveBeenCalled();
  });

  it("shows the ready suggested model and submits it explicitly", async () => {
    mount("/?project=p1");
    expect(screen.getByRole("button", { name: /^Model: / })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Behavior:/ })).toBeNull();
    fireEvent.change(prompt(), { target: { value: "Run" } });
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await vi.waitFor(() => expect(fakes.start).toHaveBeenCalledOnce());
    expect(fakes.start.mock.calls[0]?.[0]).toMatchObject({
      projectId: "p1",
      model: {
        selection: {
          kind: "resolved",
          backend: "arcee-api",
          model: "glm-5",
          base_url: "https://api.arcee.ai/v1",
        },
      },
    });
  });

  it("sends an explicitly selected reasoning level", async () => {
    mount();
    chooseModel();
    fireEvent.click(screen.getByRole("radio", { name: "Low" }));
    fireEvent.change(prompt(), { target: { value: "Go" } });
    fireEvent.keyDown(prompt(), { key: "Enter" });
    await vi.waitFor(() =>
      expect(fakes.start).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            selection: expect.objectContaining({
              model: "glm-5",
              reasoning_effort: "low",
            }),
          }),
        }),
      ),
    );
  });

  it("sends an explicitly chosen Fast tier with its selected model", async () => {
    mount();
    chooseModel(/gpt-6\.1-sol/i);
    const fast = screen.getByRole("switch", { name: "Fast speed" });
    fireEvent.click(fast);
    fireEvent.change(prompt(), { target: { value: "Fast run" } });
    fireEvent.keyDown(prompt(), { key: "Enter" });
    await vi.waitFor(() =>
      expect(fakes.start).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            selection: expect.objectContaining({
              backend: "openai-chat-completions",
              model: "gpt-6.1-sol",
              service_tier: "fast",
            }),
          }),
        }),
      ),
    );
  });

  it("keeps an unsent draft across visits and sends nothing without a prompt", () => {
    mount();
    fireEvent.change(prompt(), { target: { value: "Half a thought" } });
    cleanup();
    mount();
    expect((prompt() as HTMLTextAreaElement).value).toBe("Half a thought");
    fireEvent.change(prompt(), { target: { value: "   " } });
    const send = screen.getByRole("button", {
      name: "Start session",
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("leaves an unknown requested project unchosen rather than starting elsewhere", () => {
    mount("/?project=gone");
    expect(prompt().getAttribute("placeholder")).toBe(
      "That project is no longer available. Choose a project.",
    );
    fireEvent.change(prompt(), { target: { value: "Anything" } });
    const send = screen.getByRole("button", {
      name: "Start session",
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /^Project: (Atlas|Borealis)/ })).toBeNull();
  });

  it("says where a kept draft will start when New session points it at another project", () => {
    mount("/?project=p1");
    fireEvent.change(prompt(), { target: { value: "Plan the release" } });
    expect(screen.queryByText(/Your draft will start in/)).toBeNull();
    cleanup();
    mount("/?project=p2");
    expect((prompt() as HTMLTextAreaElement).value).toBe("Plan the release");
    expect(document.activeElement).toBe(prompt());
    expect(screen.getByText(/Your draft will start in/).textContent).toBe(
      "Your draft will start in Borealis, not Atlas.",
    );
    fireEvent.change(prompt(), { target: { value: "Plan the release notes" } });
    expect(screen.queryByText(/Your draft will start in/)).toBeNull();
    expect(fakes.start).not.toHaveBeenCalled();
  });

  it("folds checkout choices behind ⋯", () => {
    mount("/", false);
    expect(screen.queryByRole("switch", { name: "Isolated checkout" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Additional settings" }));
    const isolated = screen.getByRole("switch", { name: "Isolated checkout" });
    expect((isolated as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Needs a direct agent in a local Git project.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /^Start from/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("routes an isolated-checkout send through the isolated task form", () => {
    fakes.eligible = true;
    mount("/", false);
    chooseModel();
    fireEvent.click(screen.getByRole("button", { name: "Additional settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Isolated checkout" }));
    expect(screen.getByRole("button", { name: /^Start from/ }).textContent).toContain("main");
    fireEvent.change(prompt(), { target: { value: "Upgrade the toolchain" } });
    fireEvent.click(screen.getByRole("button", { name: "Set up isolated task" }));
    const form = screen.getByRole("dialog", { name: "New isolated task" });
    expect(form.textContent).toContain("Upgrade the toolchain");
    expect(form.getAttribute("data-ref")).toBe("");
    expect(fakes.start).not.toHaveBeenCalled();
  });

  it("uses the edited isolated-task brief and keeps newer Home text when falling back", async () => {
    fakes.eligible = true;
    mount("/", false);
    chooseModel();
    fireEvent.click(screen.getByRole("button", { name: "Additional settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Isolated checkout" }));
    fireEvent.change(prompt(), { target: { value: "Initial task brief" } });
    fireEvent.click(screen.getByRole("button", { name: "Set up isolated task" }));
    fireEvent.change(prompt(), { target: { value: "New Home draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Use existing checkout" }));
    await vi.waitFor(() =>
      expect(fakes.start).toHaveBeenCalledWith({
        projectId: "p2",
        prompt: "Edited task brief",
        model: expect.objectContaining({
          selection: expect.objectContaining({ model: "glm-5" }),
        }),
      }),
    );
    expect((prompt() as HTMLTextAreaElement).value).toBe("New Home draft");
  });

  it("starts an isolated checkout from a typed ref", () => {
    fakes.eligible = true;
    mount("/", false);
    chooseModel();
    fireEvent.click(screen.getByRole("button", { name: "Additional settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Isolated checkout" }));
    fireEvent.click(screen.getByRole("button", { name: /^Start from/ }));
    const input = screen.getByRole("textbox", {
      name: "Branch, tag or commit",
    });
    fireEvent.change(input, { target: { value: " release/2.4 " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: /^Start from/ }).textContent).toContain(
      "release/2.4",
    );

    fireEvent.change(prompt(), { target: { value: "Backport the fix" } });
    fireEvent.click(screen.getByRole("button", { name: "Set up isolated task" }));
    expect(screen.getByRole("dialog", { name: "New isolated task" }).getAttribute("data-ref")).toBe(
      "release/2.4",
    );
  });

  it("groups projects under where they run, naming an SSH host on the chip", () => {
    const withRemote = [
      ...projects,
      {
        project_id: "p3",
        name: "Render farm",
        cwd: "/srv/render",
        ssh_host: "build-box",
        pinned: false,
      },
    ] as ProjectRecord[];
    mount("/", false, withRemote);
    expect(screen.queryByRole("button", { name: /^Location:/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Project: Borealis" }));
    const local = screen.getByRole("group", { name: "This computer" });
    const remote = screen.getByRole("group", { name: "build-box" });
    expect(local.compareDocumentPosition(remote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      Array.from(local.querySelectorAll('[role="menuitemradio"]'), (item) => item.textContent),
    ).toEqual(["Atlas/atlas", "Borealis/borealis"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Render farm/ }));
    expect(screen.getByRole("button", { name: "Project: Render farm" }).textContent).toBe(
      "build-box / Render farm",
    );
  });

  it("adds a repository from the project picker on a managed host", () => {
    fakes.managed = true;
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Project: Borealis" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add repository…" }));
    expect(fakes.addRepository).toHaveBeenCalledOnce();
    expect(fakes.create).not.toHaveBeenCalled();
  });
});
