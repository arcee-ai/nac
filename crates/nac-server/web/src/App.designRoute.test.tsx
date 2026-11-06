/** @vitest-environment jsdom */
import { stderr } from "node:process";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  imported: vi.fn(),
  mounted: vi.fn(),
  unmounted: vi.fn(),
  navigate: new Map<number, (path: string) => void>(),
  useRuntime: undefined as unknown as () => import("./app/runtime/nativeRuntime").NativeRuntime,
  useNavigate: undefined as unknown as typeof import("react-router-dom").useNavigate,
}));

vi.mock("./app/features/heartbeats/HeartbeatAttentionController", () => ({
  HeartbeatAttentionController: () => null,
}));
vi.mock("./app/providers/ThemeProvider", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
  useTheme: () => ({ resolved: "dark" }),
}));
vi.mock("./app/features/ui-policy/UiPolicyProvider", () => ({
  UiPolicyProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./app/features/ui-policy/UiPolicyContext", () => ({
  useUiPolicy: () => ({
    orchestrationEnabled: state.useRuntime().scope.owner !== "direct",
  }),
}));
vi.mock("./app/providers/ToastProvider", () => ({
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./app/providers/SessionActionsProvider", () => ({
  SessionActionsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./app/providers/ProjectActionsProvider", () => ({
  ProjectActionsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./app/features/managed/controller/ManagedHostProvider", () => ({
  ManagedHostProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./app/features/product-context/ProductNavigationProvider", () => ({
  ProductNavigationProvider: ({ children }: { children: ReactNode }) => {
    const runtime = state.useRuntime();
    const navigate = state.useNavigate();
    useEffect(() => {
      state.navigate.set(runtime.id, navigate);
      return () => {
        state.navigate.delete(runtime.id);
      };
    }, [runtime, navigate]);
    useEffect(() => {
      state.mounted(runtime.id);
      return () => state.unmounted(runtime.id);
    }, [runtime]);
    return children;
  },
}));
vi.mock("./app/features/desktop-commands/DesktopCommandOwner", () => ({
  DesktopCommandOwner: () => null,
}));
vi.mock("./app/components/AppShell", async () => {
  const { Outlet } = await import("react-router-dom");
  return { AppShell: () => <Outlet /> };
});
vi.mock("./app/components/LeftSidebar", () => ({ LeftSidebar: () => null }));
vi.mock("./app/components/pages/ProjectRedirectPage", () => ({
  default: () => <p>Project</p>,
}));
vi.mock("./app/components/pages/ProjectsListPage", () => ({
  default: () => <p>Projects</p>,
}));
vi.mock("./app/features/heartbeats/fresh/ProjectTaskSchedulesPage", () => ({
  default: () => <p>Task schedules</p>,
}));
vi.mock("./app/components/pages/SessionPage", () => ({
  default: () => {
    const drafts = state.useRuntime().stores.promptDraftStore;
    const draft = drafts.useDraft("route-fixture");
    return (
      <input
        aria-label="Session draft"
        value={draft.text}
        onChange={(event) => drafts.update("route-fixture", event.target.value)}
      />
    );
  },
}));

type Runtime = ReturnType<typeof import("./app/runtime/nativeRuntime").createNativeRuntime>;
let NativePresentationRoot: typeof import("./app/runtime/NativePresentationRoot").NativePresentationRoot;
let MemoryRouter: typeof import("react-router-dom").MemoryRouter;
let createRuntime: typeof import("./app/runtime/nativeRuntime").createNativeRuntime;
let createClient: typeof import("./app/services/nacClient").createNacClient;
let resolvePage: (value: { default: ComponentType }) => void;
let rejectPage: (reason: Error) => void;
const runtimes: Runtime[] = [];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  state.navigate.clear();
  const page = new Promise<{ default: ComponentType }>((resolve, reject) => {
    resolvePage = resolve;
    rejectPage = reject;
  });
  vi.doMock("./app/components/pages/DesignPreviewPage", () => {
    state.imported();
    return page;
  });
  ({ MemoryRouter, useNavigate: state.useNavigate } = await import("react-router-dom"));
  state.useRuntime = (await import("./app/runtime/RuntimeContext"))
    .useNativeRuntime as () => Runtime;
  ({ NativePresentationRoot } = await import("./app/runtime/NativePresentationRoot"));
  ({ createNativeRuntime: createRuntime } = await import("./app/runtime/nativeRuntime"));
  ({ createNacClient: createClient } = await import("./app/services/nacClient"));
});
afterEach(() => {
  cleanup();
  for (const runtime of runtimes.splice(0)) runtime.close();
  vi.doUnmock("./app/components/pages/DesignPreviewPage");
  vi.doUnmock("./app/components/pages/design-preview/ButtonsSection");
  vi.doUnmock("./app/components/pages/design-preview/FilesAtomsSection");
  vi.unstubAllGlobals();
});

function fixture(owner: string, route: string) {
  const fetch = vi.fn();
  const runtime = createRuntime({
    scope: {
      owner,
      profile: owner,
      organization: "test",
      host: "test",
      incarnation: owner,
      endpoint: "/test",
      release: "test",
    },
    client: createClient({ endpoint: "/test", fetch }),
  });
  runtimes.push(runtime);
  const view = render(
    <NativePresentationRoot
      runtime={runtime}
      className={`presentation-${owner}`}
      theme={(child) => child}
      router={(child) => <MemoryRouter initialEntries={[route]}>{child}</MemoryRouter>}
    />,
  );
  return { runtime, view, fetch, ui: within(view.container) };
}
function PreviewProbe() {
  const runtime = state.useRuntime();
  const [draft, setDraft] = useState("");
  return (
    <section aria-label="Loaded design preview">
      <p>{runtime.scope.owner}</p>
      <input
        aria-label="Preview draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </section>
  );
}

it("loads only the allowed design route, fences late resolution and isolates two presentation roots", async () => {
  const ordinary = fixture("ordinary", "/session/one/files");
  const direct = fixture("direct", "/design");
  await direct.ui.findByText("Projects");
  fireEvent.change(ordinary.ui.getByRole("textbox", { name: "Session draft" }), {
    target: { value: "retained unsent draft" },
  });
  expect(state.imported).not.toHaveBeenCalled();
  await act(async () => state.navigate.get(ordinary.runtime.id)!("/design"));
  await ordinary.ui.findByRole("status");
  await waitFor(() => expect(state.imported).toHaveBeenCalledOnce());
  const retiring = fixture("retiring", "/design");
  await retiring.ui.findByRole("status");
  await act(async () => {
    state.navigate.get(ordinary.runtime.id)!("/");
    retiring.runtime.close();
  });
  const first = fixture("first", "/design");
  const second = fixture("second", "/design");
  await first.ui.findByRole("status");
  await second.ui.findByRole("status");
  expect(state.imported).toHaveBeenCalledOnce();
  const host = document.createElement("button");
  host.textContent = "Host control";
  document.body.append(host);
  try {
    host.focus();
    await act(async () => resolvePage({ default: PreviewProbe }));
    await first.ui.findByRole("region", { name: "Loaded design preview" });
    await second.ui.findByRole("region", { name: "Loaded design preview" });
    expect(document.activeElement).toBe(host);
    expect(ordinary.ui.queryByRole("region")).toBeNull();
    expect(retiring.view.container.textContent).toBe("");
    fireEvent.change(first.ui.getByRole("textbox", { name: "Preview draft" }), {
      target: { value: "first only" },
    });
    expect(second.ui.getByRole("textbox", { name: "Preview draft" })).toHaveProperty("value", "");
    expect(
      first.view.container.querySelector("[data-nac-runtime]")?.getAttribute("data-nac-runtime"),
    ).not.toBe(
      second.view.container.querySelector("[data-nac-runtime]")?.getAttribute("data-nac-runtime"),
    );
    expect(first.view.container.querySelector("[data-nac-overlays]")).not.toBe(
      second.view.container.querySelector("[data-nac-overlays]"),
    );
    await act(async () => state.navigate.get(ordinary.runtime.id)!("/session/one/files"));
    expect(ordinary.ui.getByRole("textbox", { name: "Session draft" })).toHaveProperty(
      "value",
      "retained unsent draft",
    );
    expect(state.unmounted.mock.calls.some(([id]) => id === ordinary.runtime.id)).toBe(false);
    expect(first.runtime.isClosed()).toBe(false);
    expect(second.runtime.isClosed()).toBe(false);
    expect(state.imported).toHaveBeenCalledOnce();
  } finally {
    host.remove();
  }
});

it("keeps import failure local to design and does not automatically retry", async () => {
  const current = fixture("failure", "/design");
  await current.ui.findByRole("status");
  await waitFor(() => expect(state.imported).toHaveBeenCalledOnce());
  await act(async () => rejectPage(new Error("Controlled design chunk failure")));
  expect((await current.ui.findByRole("alert")).textContent).toContain("Reload this page");
  expect(current.runtime.isClosed()).toBe(false);
  await act(async () => state.navigate.get(current.runtime.id)!("/"));
  await current.ui.findByText("Projects");
  await act(async () => state.navigate.get(current.runtime.id)!("/design"));
  await current.ui.findByRole("alert");
  expect(state.imported).toHaveBeenCalledOnce();
  expect(state.unmounted).not.toHaveBeenCalled();
});

it("keeps the actual complete showcase and its modal local to the selected presentation", async () => {
  const started = performance.now();
  const phase = (name: string) => {
    stderr.write(`[showcase-timing] ${name} ${Math.round(performance.now() - started)}ms\n`);
  };
  const current = fixture("showcase", "/design");
  const sibling = fixture("sibling", "/session/other/files");
  fireEvent.change(sibling.ui.getByRole("textbox", { name: "Session draft" }), {
    target: { value: "sibling unsent draft" },
  });
  await current.ui.findByRole("status");
  phase("cold-import-start");
  const actual = await vi.importActual<{ default: ComponentType }>(
    "./app/components/pages/DesignPreviewPage",
  );
  phase("cold-import-complete");
  await act(async () => resolvePage(actual));
  await current.ui.findByText("design system");
  phase("showcase-rendered");
  for (const section of ["Buttons", "Inputs", "Files", "Insights"]) {
    expect(current.ui.getByText(section, { exact: true })).toBeTruthy();
  }
  const modalControls = current.ui.getByText("Open modal", {
    selector: "button",
    exact: true,
  }).parentElement;
  expect(modalControls).not.toBeNull();
  fireEvent.click(within(modalControls!).getByRole("button", { name: "Open modal" }));
  const dialog = await current.ui.findByRole("dialog", {
    name: "Delete session",
  });
  phase("dialog-open");
  expect(sibling.ui.queryByRole("dialog")).toBeNull();
  expect(sibling.ui.getByRole("textbox", { name: "Session draft" })).toHaveProperty(
    "value",
    "sibling unsent draft",
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(current.ui.queryByRole("dialog")).toBeNull());
  phase("dialog-closed");
  expect(sibling.runtime.isClosed()).toBe(false);
  expect(current.fetch).not.toHaveBeenCalled();
  expect(sibling.fetch).not.toHaveBeenCalled();
  phase("assertions-complete");
});

it.each(["Cancel", "Escape", "overlay"] as const)(
  "keeps actual showcase sections and editor state settled when the modal closes through %s",
  async (dismiss) => {
    // These pass-through boundaries execute the real sections. They belong to
    // this isolated characterization, not the unchanged cold performance case.
    const rendered = { buttons: vi.fn(), files: vi.fn() };
    vi.doMock("./app/components/pages/design-preview/ButtonsSection", async () => {
      const actual = await vi.importActual<
        typeof import("./app/components/pages/design-preview/ButtonsSection")
      >("./app/components/pages/design-preview/ButtonsSection");
      return {
        ...actual,
        ButtonsSection: () => {
          rendered.buttons();
          return <actual.ButtonsSection />;
        },
      };
    });
    vi.doMock("./app/components/pages/design-preview/FilesAtomsSection", async () => {
      const actual = await vi.importActual<
        typeof import("./app/components/pages/design-preview/FilesAtomsSection")
      >("./app/components/pages/design-preview/FilesAtomsSection");
      return {
        ...actual,
        FilesAtomsSection: () => {
          rendered.files();
          return <actual.FilesAtomsSection />;
        },
      };
    });
    const current = fixture("modal-owner", "/design");
    const sibling = fixture("modal-sibling", "/session/other/files");
    const siblingDraft = sibling.ui.getByRole("textbox", { name: "Session draft" });
    fireEvent.change(siblingDraft, { target: { value: "sibling retained draft" } });
    const actual = await vi.importActual<{ default: ComponentType }>(
      "./app/components/pages/DesignPreviewPage",
    );
    await act(async () => resolvePage(actual));
    await current.ui.findByText("design system");
    expect(rendered.buttons).toHaveBeenCalled();
    expect(rendered.files).toHaveBeenCalled();
    const settled = {
      buttons: rendered.buttons.mock.calls.length,
      files: rendered.files.mock.calls.length,
    };
    const editor = current.ui.getByLabelText("Working directory", {
      selector: "input",
    }) as HTMLInputElement;
    fireEvent.change(editor, { target: { value: "/tmp/retained-directory" } });
    act(() => {
      editor.focus();
      editor.setSelectionRange(5, 13);
    });
    const opener = current.ui.getByText("Open modal", {
      selector: "button",
      exact: true,
    }).parentElement!;
    const button = within(opener).getByRole("button", { name: "Open modal" });
    act(() => button.focus());
    fireEvent.click(button);
    const dialog = await current.ui.findByRole("dialog", { name: "Delete session" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(rendered.buttons).toHaveBeenCalledTimes(settled.buttons);
    expect(rendered.files).toHaveBeenCalledTimes(settled.files);
    expect(sibling.ui.queryByRole("dialog")).toBeNull();
    if (dismiss === "Cancel") {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    } else if (dismiss === "Escape") {
      fireEvent.keyDown(dialog, { key: "Escape" });
    } else {
      const overlay = current.view.container.querySelector('[data-slot="dialog-overlay"]');
      expect(overlay).not.toBeNull();
      fireEvent.mouseDown(overlay!);
      fireEvent.click(overlay!);
    }
    await waitFor(() => expect(current.ui.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(rendered.buttons).toHaveBeenCalledTimes(settled.buttons);
    expect(rendered.files).toHaveBeenCalledTimes(settled.files);
    expect(current.ui.getByLabelText("Working directory", { selector: "input" })).toBe(editor);
    expect(editor.value).toBe("/tmp/retained-directory");
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([5, 13]);
    expect(siblingDraft).toHaveProperty("value", "sibling retained draft");
    expect(sibling.runtime.isClosed()).toBe(false);
    expect(current.fetch).not.toHaveBeenCalled();
    expect(sibling.fetch).not.toHaveBeenCalled();
  },
);
