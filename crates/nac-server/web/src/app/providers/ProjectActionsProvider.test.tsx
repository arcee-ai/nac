/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UiPolicyContext } from "@/app/features/ui-policy/UiPolicyContext";
import { DIRECT_UI_POLICY, ORCHESTRATION_UI_POLICY } from "@/app/features/ui-policy/policy";
import { chatTabsStore, dismissChatTab, setChatTabOrder } from "@/app/store/chatTabsStore";
import {
  sessionNavigationStore,
  markSessionViewed,
  toggleSessionNavigationPin,
} from "@/app/store/sessionNavigationStore";

import { ProjectActionsProvider, useProjectActions } from "@/app/providers/ProjectActionsProvider";

const fakes = vi.hoisted(() => ({
  sessions: [] as Array<unknown>,
  projects: [] as Array<unknown>,
  togglePin: vi.fn(),
  assign: vi.fn(),
}));

vi.mock("@/app/providers/ToastProvider", () => ({
  errorMessage: (error: unknown) => String(error),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/app/services/queries", () => ({
  useSessions: () => ({ data: fakes.sessions, isSuccess: true }),
  useProjects: () => ({ data: { projects: fakes.projects } }),
  useToggleProjectPin: () => ({ toggle: fakes.togglePin }),
  useAssignSessionToProject: () => ({ mutateAsync: fakes.assign }),
}));
vi.mock("@/app/components/modals/CreateProjectModal", () => ({
  CreateProjectModal: () => null,
}));
vi.mock("@/app/components/modals/AssignToProjectModal", () => ({
  AssignToProjectModal: () => null,
}));
vi.mock("@/app/components/modals/DeleteProjectModal", () => ({
  DeleteProjectModal: () => null,
}));
vi.mock("@/app/components/modals/RenameProjectModal", () => ({
  RenameProjectModal: () => null,
}));
function Harness() {
  const actions = useProjectActions();
  const location = useLocation();
  return (
    <>
      <button onClick={() => void actions.newChat("project-1")}>New session</button>
      <button onClick={() => void actions.newChat("project-1", true)}>Replace with composer</button>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
    </>
  );
}

function tree(orchestration = false, path = "/project/project-1") {
  return (
    <MemoryRouter initialEntries={[path]}>
      <UiPolicyContext.Provider value={orchestration ? ORCHESTRATION_UI_POLICY : DIRECT_UI_POLICY}>
        <ProjectActionsProvider>
          <Harness />
        </ProjectActionsProvider>
      </UiPolicyContext.Provider>
    </MemoryRouter>
  );
}

function mount() {
  return render(tree());
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  fakes.sessions = [];
  fakes.projects = [];
  chatTabsStore.setState({ dismissed: new Set(), order: {} });
  sessionNavigationStore.setState({ pinned: new Set(), lastViewedAt: {} });
  fakes.togglePin.mockReset();
  fakes.assign.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("project actions", () => {
  it("opens Home's composer pointed at the project instead of a dialog", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(screen.getByTestId("location").textContent).toBe("/?project=project-1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("can replace an empty project's redirect entry with the composer", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Replace with composer" }));
    expect(screen.getByTestId("location").textContent).toBe("/?project=project-1");
  });
});

it("keeps hidden orchestration navigation memory while pruning genuinely deleted sessions", () => {
  fakes.projects = [{ project_id: "project-1" }];
  fakes.sessions = ["direct", "orchestrator", "direct-with-orchestrator"].map((behavior) => ({
    summary: { session_id: behavior, behavior, project_id: "project-1" },
  }));
  const ids = ["orchestrator", "direct", "direct-with-orchestrator", "deleted"];
  for (const id of ids) {
    dismissChatTab(id);
    toggleSessionNavigationPin(id);
    markSessionViewed(id, "2026-09-30T12:00:00Z");
  }
  setChatTabOrder("project-1", ids);
  const view = mount();
  const assertRetained = () => {
    expect(chatTabsStore.getState().order["project-1"]).toEqual(ids.slice(0, 3));
    expect([...chatTabsStore.getState().dismissed]).toEqual(ids.slice(0, 3));
    expect([...sessionNavigationStore.getState().pinned]).toEqual(ids.slice(0, 3));
    expect(Object.keys(sessionNavigationStore.getState().lastViewedAt)).toEqual(ids.slice(0, 3));
    expect(JSON.parse(localStorage.getItem("nac.chatTabs")!).order["project-1"]).toEqual(
      ids.slice(0, 3),
    );
    expect(JSON.parse(localStorage.getItem("nac.sessionNavigation")!).pinned).toEqual(
      ids.slice(0, 3),
    );
  };
  assertRetained();
  view.rerender(tree(true));
  assertRetained();
});
