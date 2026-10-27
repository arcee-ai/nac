/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { ManagedSessionSummary } from "@/app/types/api";
import { MobileSearchModal } from "./MobileSearchModal";
import { SidebarProjectList } from "./SidebarProjectList";

const session = {
  summary: {
    session_id: "current",
    title: "Current chat",
    behavior: "direct",
    updated_at: "2026-10-26T00:00:00Z",
  },
  lineage: null,
} as ManagedSessionSummary;
vi.mock("@/app/services/queries", () => ({
  useVisibleSessions: () => ({ data: [session] }),
  useSessions: () => ({ data: [session] }),
  useProjects: () => ({ data: { projects: [] } }),
}));
vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => true }));
vi.mock("@/app/providers/SessionActionsProvider", () => ({ useSessionActions: () => ({}) }));
afterEach(cleanup);
it("dismisses search and its parent even when the chosen chat is already current", () => {
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  render(
    <MemoryRouter initialEntries={["/session/current/insights"]}>
      <MobileSearchModal
        open
        onClose={onClose}
        onNavigate={onNavigate}
        kind="chats"
        activeSessionId="current"
        activeProjectId={null}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Current chat" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onNavigate).toHaveBeenCalledOnce();
});
it("dismisses the tree when choosing its already-current standalone chat", () => {
  const onNavigate = vi.fn();
  render(
    <MemoryRouter initialEntries={["/session/current/insights"]}>
      <SidebarProjectList
        projects={[]}
        sessions={[session]}
        query=""
        activeSessionId="current"
        activeProjectId={null}
        mobile
        onNavigate={onNavigate}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Current chat" }));
  expect(onNavigate).toHaveBeenCalledOnce();
});
