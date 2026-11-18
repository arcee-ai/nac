/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MOD } from "@/app/lib/shortcuts";
import { ProjectActionsProvider, useProjectActions } from "@/app/providers/ProjectActionsProvider";

import { NewSessionShortcut } from "./NewSessionShortcut";

const fakes = vi.hoisted(() => ({
  sessions: [] as Array<unknown>,
  projects: [] as Array<unknown>,
}));

vi.mock("@/app/providers/ToastProvider", () => ({
  errorMessage: (error: unknown) => String(error),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/app/services/queries", () => ({
  useSessions: () => ({ data: fakes.sessions, isSuccess: true }),
  useProjects: () => ({ data: { projects: fakes.projects } }),
  useToggleProjectPin: () => ({ toggle: vi.fn() }),
  useAssignSessionToProject: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/app/components/modals/CreateProjectModal", async () => {
  const { Modal } = await import("@/app/atoms");
  return {
    CreateProjectModal: ({ open, onClose }: { open: boolean; onClose: () => void }) => (
      <Modal open={open} onClose={onClose} title="New Project">
        <p>Form</p>
      </Modal>
    ),
  };
});
vi.mock("@/app/components/modals/AssignToProjectModal", () => ({
  AssignToProjectModal: () => null,
}));
vi.mock("@/app/components/modals/DeleteProjectModal", () => ({
  DeleteProjectModal: () => null,
}));
vi.mock("@/app/components/modals/RenameProjectModal", () => ({
  RenameProjectModal: () => null,
}));

function Location() {
  const location = useLocation();
  const state = location.state as { focusComposer?: number } | null;
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <output data-testid="focus">{state?.focusComposer ? "focus" : ""}</output>
    </>
  );
}

function OpenCreate() {
  const actions = useProjectActions();
  return <button onClick={actions.create}>Open create</button>;
}

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ProjectActionsProvider>
        <NewSessionShortcut />
        <OpenCreate />
        <Location />
      </ProjectActionsProvider>
    </MemoryRouter>,
  );
}

function press(init: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, {
    key: "o",
    shiftKey: true,
    ctrlKey: MOD === "ctrl",
    metaKey: MOD === "meta",
    ...init,
  });
}

const location = () => screen.getByTestId("location").textContent;

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  fakes.projects = [{ project_id: "project-1" }];
  fakes.sessions = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("opens Home's composer for the project on screen", () => {
  mount("/project/project-1");
  press();
  expect(location()).toBe("/?project=project-1");
  expect(screen.getByTestId("focus").textContent).toBe("focus");
});

it.each(["direct", "orchestrator", "direct-with-orchestrator"])(
  "keeps a %s session's project, hidden or not",
  (behavior) => {
    fakes.sessions = [{ summary: { session_id: "s", behavior, project_id: "project-1" } }];
    mount("/session/s/threads");
    press();
    expect(location()).toBe("/?project=project-1");
  },
);

it("waits for an unknown session rather than guessing its project", () => {
  mount("/session/unknown/threads");
  press();
  expect(location()).toBe("/session/unknown/threads");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("refocuses Home's composer and keeps its project on Home", () => {
  mount("/?project=project-1");
  press();
  expect(location()).toBe("/?project=project-1");
  expect(screen.getByTestId("focus").textContent).toBe("focus");
});

it("never opens project creation, even with no projects", () => {
  fakes.projects = [];
  mount("/task-schedules");
  press();
  expect(location()).toBe("/");
  expect(screen.queryByRole("dialog", { name: "New Project" })).toBeNull();
});

it("ignores keys inside an IME composition", () => {
  mount("/project/project-1");
  press({ isComposing: true });
  expect(location()).toBe("/project/project-1");
});

it("steps aside while a dialog owns the keyboard", () => {
  mount("/project/project-1");
  fireEvent.click(screen.getByRole("button", { name: "Open create" }));
  expect(screen.getByRole("dialog", { name: "New Project" })).toBeTruthy();
  press();
  expect(location()).toBe("/project/project-1");
});
