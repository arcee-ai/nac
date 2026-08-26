/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectActionsProvider, useProjectActions } from "@/app/providers/ProjectActionsProvider";

const fakes = vi.hoisted(() => ({
  sessions: [] as Array<unknown>,
  togglePin: vi.fn(),
  assign: vi.fn(),
}));

vi.mock("@/app/hooks/useKeyboardShortcuts", () => ({ useKeyboardShortcuts: () => undefined }));
vi.mock("@/app/providers/ToastProvider", () => ({
  errorMessage: (error: unknown) => String(error),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/app/store/chatTabsStore", () => ({ pruneChatTabs: () => undefined }));
vi.mock("@/app/services/queries", () => ({
  useSessions: () => ({ data: fakes.sessions, isSuccess: true }),
  useProjects: () => ({ data: { projects: [] } }),
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
vi.mock("@/app/components/modals/NewChatModal", () => ({
  NewChatModal: ({
    projectId,
    onClose,
  }: {
    projectId: string | null;
    firstChat?: boolean;
    onClose: () => void;
  }) => (projectId ? <button onClick={onClose}>Close required chat</button> : null),
}));

function Harness() {
  const actions = useProjectActions();
  const location = useLocation();
  return (
    <>
      <button onClick={() => void actions.newChat("project-1")}>Open required chat</button>
      <output data-testid="location">{location.pathname}</output>
    </>
  );
}

function mount() {
  return render(
    <MemoryRouter initialEntries={["/project/project-1"]}>
      <ProjectActionsProvider>
        <Harness />
      </ProjectActionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fakes.sessions = [];
  fakes.togglePin.mockReset();
  fakes.assign.mockReset();
});

afterEach(cleanup);

describe("project actions", () => {
  it("treats a delegated-only project as empty when the required chat is closed", () => {
    fakes.sessions = [
      {
        summary: { session_id: "child", project_id: "project-1" },
        lineage: { parent_session_id: "parent", relationship_kind: "traditional-child" },
      },
    ];
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Open required chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Close required chat" }));
    expect(screen.getByTestId("location").textContent).toBe("/");
  });
});
