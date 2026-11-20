/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

import { routes } from "@/app/lib/routes";
import type { ManagedSessionSummary, SessionBehavior } from "@/app/types/api";
import { useSidebarCommands } from "./useSidebarCommands";

vi.mock("@/app/features/product-context/context", () => ({
  useProductNavigationOwner: () => ({
    openMcp: vi.fn(),
    openSsh: vi.fn(),
    openSettings: vi.fn(),
    inspect: vi.fn(),
  }),
}));
const state = vi.hoisted(() => ({
  sessions: undefined as ManagedSessionSummary[] | undefined,
  projects: [{ id: "project" }] as unknown[] | undefined,
  newChat: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/app/services/queries", () => ({
  useSessions: () => ({ data: state.sessions }),
  useProjects: () => ({ data: state.projects && { projects: state.projects } }),
  useVisibleSessions: () => ({ data: [] }),
  useMcpServers: () => ({ data: { servers: [] } }),
  useSshConfigs: () => ({ data: { configurations: [] } }),
}));
vi.mock("@/app/providers/ProjectActionsProvider", () => ({
  useProjectActions: () => ({ newChat: state.newChat, create: state.create }),
}));
vi.mock("@/app/features/managed/controller/useManagedHost", () => ({
  useManagedHost: () => ({ isManaged: false }),
}));
vi.mock("@/app/components/modals/MCPServersModal/McpServersModal", () => ({
  McpServersModal: () => null,
}));
vi.mock("@/app/components/modals/SshConfigsModal", () => ({
  SshConfigsModal: () => null,
}));

function legacy(behavior: SessionBehavior): ManagedSessionSummary {
  // SAFETY: this command only reads the canonical session/project identities.
  return {
    summary: { session_id: "legacy", project_id: "project", behavior },
  } as ManagedSessionSummary;
}
function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={[routes.session("legacy")]}>{children}</MemoryRouter>;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.sessions = undefined;
  state.projects = [{ id: "project" }];
});

it.each(["orchestrator", "direct-with-orchestrator"] as const)(
  "opens a new chat in a hidden %s session's project without exposing it in navigation",
  (behavior) => {
    state.sessions = [legacy(behavior)];
    const { result } = renderHook(useSidebarCommands, { wrapper });
    act(() => result.current.newSession());
    expect(state.newChat).toHaveBeenCalledExactlyOnceWith("project");
    expect(state.create).not.toHaveBeenCalled();
  },
);

it("waits for canonical route identity before choosing a creation destination", () => {
  const { result, rerender } = renderHook(useSidebarCommands, { wrapper });
  act(() => expect(result.current.newSession()).toBe(false));
  expect(state.create).not.toHaveBeenCalled();
  expect(state.newChat).not.toHaveBeenCalled();
  state.sessions = [legacy("orchestrator")];
  rerender();
  act(() => result.current.newSession());
  expect(state.newChat).toHaveBeenCalledExactlyOnceWith("project");
  expect(state.create).not.toHaveBeenCalled();
});

it("sends a project-less new session to Home's composer instead of a new project", () => {
  state.sessions = [];
  const { result } = renderHook(useSidebarCommands, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={["/task-schedules"]}>{children}</MemoryRouter>
    ),
  });
  act(() => expect(result.current.newSession()).toBe(true));
  expect(state.create).not.toHaveBeenCalled();
  expect(state.newChat).not.toHaveBeenCalled();
});

it("never starts project creation, even with no projects", () => {
  state.sessions = [];
  state.projects = [];
  const { result } = renderHook(useSidebarCommands, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>
    ),
  });
  act(() => expect(result.current.newSession()).toBe(true));
  expect(state.create).not.toHaveBeenCalled();
  expect(state.newChat).not.toHaveBeenCalled();
});

it("stays on Home's composer and its project when already Home", () => {
  state.sessions = [];
  const { result } = renderHook(
    () => ({ commands: useSidebarCommands(), location: useLocation() }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={["/?project=project"]}>{children}</MemoryRouter>
      ),
    },
  );
  act(() => expect(result.current.commands.newSession()).toBe(true));
  expect(result.current.location.search).toBe("?project=project");
  expect(result.current.location.state).toMatchObject({ focusComposer: expect.any(Number) });
  expect(state.create).not.toHaveBeenCalled();
});
