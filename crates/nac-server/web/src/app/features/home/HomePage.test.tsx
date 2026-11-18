/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UiPolicyContext } from "@/app/features/ui-policy/UiPolicyContext";
import { DIRECT_UI_POLICY } from "@/app/features/ui-policy/policy";

import { HomePage } from "./HomePage";

const fakes = vi.hoisted(() => ({
  projects: { data: undefined, isPending: false, error: null } as {
    data: { projects: unknown[] } | undefined;
    isPending: boolean;
    error: Error | null;
    refetch?: () => void;
  },
  sessions: { data: [] as unknown[], isPending: false, error: null as Error | null },
  mobile: false,
  managed: false,
  create: vi.fn(),
  addRepository: vi.fn(),
}));

vi.mock("@/app/services/queries", () => ({
  useProjects: () => ({ refetch: vi.fn(), ...fakes.projects }),
  useSessions: () => ({ refetch: vi.fn(), ...fakes.sessions }),
}));
vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => fakes.mobile }));
vi.mock("@/app/features/managed/controller/useManagedHost", () => ({
  useManagedHost: () => ({
    isManaged: fakes.managed,
    addRepository: fakes.addRepository,
    openSettings: vi.fn(),
    status: { model_ready: true, github_status: "connected" },
  }),
}));
vi.mock("@/app/providers/ProjectActionsProvider", () => ({
  useProjectActions: () => ({ create: fakes.create }),
}));
vi.mock("./useDefaultProject", () => ({ useDefaultProject: () => false }));
vi.mock("./HomeComposer", () => ({ HomeComposer: () => <div data-testid="composer" /> }));
vi.mock("./NeedsYouLine", () => ({ NeedsYouLine: () => null }));
vi.mock("@/app/components/LeftSidebar", () => ({ LeftSidebar: () => null }));
vi.mock("@/app/features/sidebar/SidebarToggle", () => ({ SidebarToggle: () => null }));
vi.mock("@/app/features/inbox/SessionLists", () => ({
  SessionListBody: () => null,
  SessionListSwitch: () => null,
}));

const project = { project_id: "p1", name: "Atlas", cwd: "/atlas", pinned: false };
const orphan = {
  summary: { session_id: "loose", project_id: null, behavior: "direct", updated_at: "2026" },
};

function mount() {
  return render(
    <MemoryRouter>
      <UiPolicyContext.Provider value={DIRECT_UI_POLICY}>
        <HomePage />
      </UiPolicyContext.Provider>
    </MemoryRouter>,
  );
}

const addProject = () => screen.queryByRole("button", { name: "Add project" });

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  fakes.projects = { data: { projects: [project] }, isPending: false, error: null };
  fakes.sessions = { data: [], isPending: false, error: null };
  fakes.mobile = false;
  fakes.managed = false;
  fakes.create.mockReset();
  fakes.addRepository.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Home below the composer", () => {
  it("leaves project details off desktop Home, below the composer", () => {
    mount();
    expect(screen.getByTestId("composer")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Projects" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Interval tasks" })).toBeNull();
    expect(addProject()).toBeNull();
  });

  it("offers both managed choices with accurate labels", () => {
    fakes.managed = true;
    fakes.mobile = true;
    mount();
    const list = screen.getByRole("region", { name: "Sessions and Inbox" });
    const trigger = within(list).getByRole("button", { name: "Add project" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Add repository/ }));
    expect(fakes.addRepository).toHaveBeenCalledOnce();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Create from an existing path/ }));
    expect(fakes.create).toHaveBeenCalledOnce();
  });

  it("is in Home's content on a phone", () => {
    fakes.mobile = true;
    mount();
    const list = screen.getByRole("region", { name: "Sessions and Inbox" });
    fireEvent.click(within(list).getByRole("button", { name: "Add project" }));
    expect(fakes.create).toHaveBeenCalledOnce();
  });

  it("is offered when only unassigned sessions exist", () => {
    fakes.mobile = true;
    fakes.projects = { data: { projects: [] }, isPending: false, error: null };
    fakes.sessions = { data: [orphan], isPending: false, error: null };
    mount();
    expect(addProject()).toBeTruthy();
  });

  it.each([
    [false, ["Get Started"]],
    [true, ["Add repository", "Create from an existing path"]],
  ] as const)("is the empty state's action (managed: %s)", (managed, labels) => {
    fakes.managed = managed;
    fakes.projects = { data: { projects: [] }, isPending: false, error: null };
    mount();
    for (const label of labels) expect(screen.getByRole("button", { name: label })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: labels.at(-1) }));
    expect(fakes.create).toHaveBeenCalledOnce();
  });

  it("is not offered while projects are loading", () => {
    fakes.projects = { data: undefined, isPending: true, error: null };
    mount();
    expect(screen.getByRole("status", { name: "Loading Home" })).toBeTruthy();
    expect(addProject()).toBeNull();
  });

  it("does not claim there are no projects when the list failed to load", () => {
    fakes.projects = { data: undefined, isPending: false, error: new Error("offline") };
    mount();
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load your projects");
    expect(screen.queryByTestId("composer")).toBeNull();
    expect(screen.queryByText("No projects yet")).toBeNull();
    expect(addProject()).toBeNull();
  });
});
