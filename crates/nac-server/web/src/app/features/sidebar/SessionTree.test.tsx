/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAttentionStore } from "@/app/store/attentionStore";
import { createSidebarLayoutStore } from "@/app/store/sidebarLayoutStore";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

import { SessionTree } from "./SessionTree";

const fakes = vi.hoisted(() => ({
  sessions: [] as unknown[],
  rename: vi.fn(),
  remove: vi.fn(),
  togglePin: vi.fn(),
  assign: vi.fn(),
  newChat: vi.fn(),
  stores: null as unknown,
}));

vi.mock("@/app/runtime/RuntimeContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/runtime/RuntimeContext")>()),
  useNativeRuntime: () => ({
    api: { getPermissions: async () => ({ requests: [] }) },
    stores: fakes.stores,
  }),
}));
vi.mock("@/app/services/queries", () => ({
  useSessions: () => ({ data: fakes.sessions }),
}));
vi.mock("@/app/providers/SessionActionsProvider", () => ({
  useSessionActions: () => ({
    rename: fakes.rename,
    remove: fakes.remove,
    togglePin: fakes.togglePin,
  }),
}));
vi.mock("@/app/providers/ProjectActionsProvider", () => ({
  useProjectActions: () => ({
    assign: fakes.assign,
    newChat: fakes.newChat,
    togglePin: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  }),
}));

const now = new Date().toISOString();

function session(
  id: string,
  title: string,
  extra: Partial<ManagedSessionSummary["summary"]> = {},
  lineage: ManagedSessionSummary["lineage"] = null,
): ManagedSessionSummary {
  // SAFETY: the tree reads identity, title, timestamps, project and lineage only.
  return {
    active: false,
    summary: {
      session_id: id,
      title,
      project_id: "project-1",
      behavior: "direct",
      updated_at: now,
      created_at: now,
      ...extra,
    },
    lineage,
  } as ManagedSessionSummary;
}

const projects = [
  { project_id: "project-1", name: "Atlas", cwd: "/atlas", pinned: false },
  { project_id: "project-2", name: "Borealis", cwd: "/borealis", pinned: false },
] as ProjectRecord[];

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function mount(sessions: ManagedSessionSummary[], active: string | null = null) {
  fakes.sessions = sessions;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <div data-sidebar="true">
          <SessionTree projects={projects} sessions={sessions} activeSessionId={active} />
        </div>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  fakes.stores = {
    sidebarLayoutStore: createSidebarLayoutStore(),
    attentionStore: createAttentionStore(),
  };
  for (const fake of [fakes.rename, fakes.remove, fakes.togglePin, fakes.assign, fakes.newChat])
    fake.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sidebar session tree", () => {
  it("groups sessions by project and marks the open one as the current page", () => {
    const view = mount(
      [session("a", "Fix the parser"), session("b", "Write docs", { project_id: "project-2" })],
      "b",
    );
    const atlas = screen.getByRole("region", { name: "Atlas" });
    expect(within(atlas).getByRole("button", { name: "Fix the parser" })).toBeTruthy();
    const current = view.container.querySelector(
      '[data-sidebar="true"] button[aria-current="page"]',
    );
    expect(current?.getAttribute("aria-label")).toBe("Write docs");
  });

  it("folds subagents under their parent until the count pill is opened", () => {
    mount([
      session("parent", "Plan the release"),
      session("child", "Audit the changelog", {}, {
        parent_session_id: "parent",
        root_session_id: "parent",
        kind: "traditional-child",
        description: "",
      } as ManagedSessionSummary["lineage"]),
    ]);
    expect(screen.queryByRole("button", { name: "Audit the changelog" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 subagent of Plan the release" }));
    expect(screen.getByRole("button", { name: "Audit the changelog" })).toBeTruthy();
  });

  it("opens a subagent's parent chain when the subagent is on screen", () => {
    mount(
      [
        session("parent", "Plan the release"),
        session("child", "Audit the changelog", {}, {
          parent_session_id: "parent",
          root_session_id: "parent",
          kind: "traditional-child",
          description: "",
        } as ManagedSessionSummary["lineage"]),
      ],
      "child",
    );
    expect(
      screen.getByRole("button", { name: "Audit the changelog" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("keeps row actions in one options menu and offers a project move for unassigned sessions", () => {
    mount([session("loose", "Loose ends", { project_id: null })]);
    const choose = (name: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Loose ends options" }));
      const menu = screen.getByRole("menu", { name: "Loose ends options" });
      fireEvent.click(within(menu).getByRole("menuitem", { name }));
    };
    choose("Delete Loose ends");
    expect(fakes.remove).toHaveBeenCalledOnce();
    choose("Move to project");
    expect(fakes.assign).toHaveBeenCalledOnce();
    choose("Rename Loose ends");
    expect(fakes.rename).toHaveBeenCalledOnce();
    choose("Pin Loose ends");
    expect(fakes.togglePin).toHaveBeenCalledOnce();
  });

  it("offers no project move for a session that already has a project", () => {
    mount([session("a", "Fix the parser")]);
    fireEvent.click(screen.getByRole("button", { name: "Fix the parser options" }));
    const menu = screen.getByRole("menu", { name: "Fix the parser options" });
    expect(within(menu).queryByRole("menuitem", { name: "Move to project" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "View full name" })).toBeTruthy();
  });

  it("starts a new session in a project through the shared project action", () => {
    mount([session("a", "Fix the parser")]);
    fireEvent.click(screen.getByRole("button", { name: "New session in Borealis" }));
    expect(fakes.newChat).toHaveBeenCalledWith("project-2");
  });

  it("opens a session row", () => {
    mount([session("a", "Fix the parser")]);
    fireEvent.click(screen.getByRole("button", { name: "Fix the parser" }));
    expect(screen.getByTestId("where").textContent).toBe("/session/a/insights");
  });

  it("organizes by status when asked", () => {
    // SAFETY: test-only access to the store created above.
    (
      fakes.stores as { sidebarLayoutStore: ReturnType<typeof createSidebarLayoutStore> }
    ).sidebarLayoutStore.setOrganize("status");
    mount([session("a", "Fix the parser"), session("b", "Write docs", {}, null)]);
    expect(screen.getByRole("region", { name: "Recent" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Atlas" })).toBeNull();
  });
});
