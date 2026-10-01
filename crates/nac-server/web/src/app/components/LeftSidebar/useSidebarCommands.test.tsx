/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

import { routes } from "@/app/lib/routes";
import type { ManagedSessionSummary, SessionBehavior } from "@/app/types/api";
import { useSidebarCommands } from "./useSidebarCommands";

const state = vi.hoisted(() => ({
  sessions: undefined as ManagedSessionSummary[] | undefined,
  newChat: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/app/services/queries", () => ({
  useSessions: () => ({ data: state.sessions }),
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
vi.mock("@/app/components/modals/ConfigurationsModal", () => ({ ConfigurationsModal: () => null }));
vi.mock("@/app/components/modals/MCPServersModal/McpServersModal", () => ({
  McpServersModal: () => null,
}));
vi.mock("@/app/components/modals/SshConfigsModal", () => ({ SshConfigsModal: () => null }));

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
  act(() => result.current.newSession());
  expect(state.create).not.toHaveBeenCalled();
  expect(state.newChat).not.toHaveBeenCalled();
  state.sessions = [legacy("orchestrator")];
  rerender();
  act(() => result.current.newSession());
  expect(state.newChat).toHaveBeenCalledExactlyOnceWith("project");
  expect(state.create).not.toHaveBeenCalled();
});
