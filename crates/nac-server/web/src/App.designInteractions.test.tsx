/** @vitest-environment jsdom */
import { useEffect, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativePresentationRoot } from "./app/runtime/NativePresentationRoot";
import { createNativeRuntime as createRuntime } from "./app/runtime/nativeRuntime";
import { createNacClient as createClient } from "./app/services/nacClient";
import { useNativeRuntime } from "./app/runtime/RuntimeContext";
import { MemoryRouter, useNavigate } from "react-router-dom";
// Functional interactions use the actual module with normal static lifetime.
// The separate route spec retains its unchanged cold-import performance oracle.
import "./app/components/pages/DesignPreviewPage";

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
const runtimes: Runtime[] = [];

beforeEach(() => {
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
  state.useNavigate = useNavigate;
  state.useRuntime = useNativeRuntime as () => Runtime;
});
afterEach(() => {
  cleanup();
  for (const runtime of runtimes.splice(0)) runtime.close();
  vi.unstubAllGlobals();
});

async function fixture(owner: string, route: string) {
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
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <NativePresentationRoot
        runtime={runtime}
        className={`presentation-${owner}`}
        theme={(child) => child}
        router={(child) => <MemoryRouter initialEntries={[route]}>{child}</MemoryRouter>}
      />,
    );
    // Settle the actual route import and Suspense commit before functional assertions.
    await import("@/app/components/pages/DesignPreviewPage");
  });
  return { runtime, view, fetch, ui: within(view.container) };
}

// The wrappers count renders while executing the real showcase sections.
const rendered = vi.hoisted(() => ({ buttons: vi.fn(), files: vi.fn() }));
vi.mock("./app/components/pages/design-preview/ButtonsSection", async () => {
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
vi.mock("./app/components/pages/design-preview/FilesAtomsSection", async () => {
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

it.each(["Cancel", "Escape", "overlay"] as const)(
  "keeps actual showcase sections and editor state settled when the modal closes through %s",
  async (dismiss) => {
    const current = await fixture("modal-owner", "/design");
    const sibling = await fixture("modal-sibling", "/session/other/files");
    const siblingDraft = sibling.ui.getByRole("textbox", { name: "Session draft" });
    fireEvent.change(siblingDraft, { target: { value: "sibling retained draft" } });
    await current.ui.findByText("design system");
    expect(rendered.buttons).toHaveBeenCalled();
    expect(rendered.files).toHaveBeenCalled();
    const settled = {
      buttons: rendered.buttons.mock.calls.length,
      files: rendered.files.mock.calls.length,
    };
    const inputSurface = current.ui.getByText("Inputs", { exact: true }).parentElement!
      .parentElement!;
    const inputUi = within(inputSurface);
    const overlays = current.view.container.querySelector<HTMLElement>("[data-nac-overlays]");
    expect(overlays).not.toBeNull();
    const overlayUi = within(overlays!);
    const editor = inputUi.getByLabelText("Working directory", {
      selector: "input",
    }) as HTMLInputElement;
    fireEvent.change(editor, { target: { value: "/tmp/retained-directory" } });
    act(() => {
      editor.focus();
      editor.setSelectionRange(5, 13);
    });
    const opener = inputUi.getByText("Open modal", {
      selector: "button",
      exact: true,
    }).parentElement!;
    const button = within(opener).getByRole("button", { name: "Open modal" });
    act(() => button.focus());
    fireEvent.click(button);
    const dialog = await overlayUi.findByRole("dialog", { name: "Delete session" });
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
    await waitFor(() => expect(overlayUi.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(rendered.buttons).toHaveBeenCalledTimes(settled.buttons);
    expect(rendered.files).toHaveBeenCalledTimes(settled.files);
    expect(inputUi.getByLabelText("Working directory", { selector: "input" })).toBe(editor);
    expect(editor.value).toBe("/tmp/retained-directory");
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([5, 13]);
    expect(siblingDraft).toHaveProperty("value", "sibling retained draft");
    expect(sibling.runtime.isClosed()).toBe(false);
    expect(current.fetch).not.toHaveBeenCalled();
    expect(sibling.fetch).not.toHaveBeenCalled();
  },
);
