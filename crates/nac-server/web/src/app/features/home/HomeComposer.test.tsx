/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UiPolicyContext } from "@/app/features/ui-policy/UiPolicyContext";
import { DIRECT_UI_POLICY, ORCHESTRATION_UI_POLICY } from "@/app/features/ui-policy/policy";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

import { HomeComposer } from "./HomeComposer";

const fakes = vi.hoisted(() => ({
  start: vi.fn(),
  create: vi.fn(),
  addRepository: vi.fn(),
  managed: false,
  eligible: false,
}));

vi.mock("./useStartSession", () => ({
  useStartSession: () => ({
    start: fakes.start,
    busy: false,
    needsReview: false,
    error: null,
    clearError: vi.fn(),
  }),
}));
vi.mock("./modelChoice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./modelChoice")>()),
  useInheritedModel: () => ({
    inherited: {
      initial: { model: "glm-5", reasoning_effort: "high", backend: "arcee-api" },
      light: null,
      source: "project-default",
    },
    pending: false,
    error: null,
  }),
}));
vi.mock("./ModelOverrideModal", () => ({ ModelOverrideModal: () => null }));
vi.mock("@/app/features/task-launches/useTaskLaunch", () => ({
  useTaskLaunchSource: (_id: string | null, enabled: boolean) => ({
    data: enabled ? { eligible: fakes.eligible, default_ref: "main" } : undefined,
  }),
}));
vi.mock("@/app/features/task-launches/TaskLaunchModal", () => ({
  TaskLaunchModal: ({ initialPrompt }: { initialPrompt: string }) => (
    <div role="dialog" aria-label="New isolated task">
      {initialPrompt}
    </div>
  ),
}));
vi.mock("@/app/features/managed/controller/useManagedHost", () => ({
  useManagedHost: () => ({ isManaged: fakes.managed, addRepository: fakes.addRepository }),
}));
vi.mock("@/app/providers/ProjectActionsProvider", () => ({
  useProjectActions: () => ({ create: fakes.create }),
}));

const projects = [
  { project_id: "p1", name: "Atlas", cwd: "/atlas", pinned: false },
  { project_id: "p2", name: "Borealis", cwd: "/borealis", pinned: false },
] as ProjectRecord[];

// SAFETY: only project identity and activity time are read here.
const sessions = [
  { summary: { session_id: "s", project_id: "p2", updated_at: "2026-11-16T10:00:00Z" } },
] as ManagedSessionSummary[];

function mount(path = "/", orchestration = true) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <UiPolicyContext.Provider value={orchestration ? ORCHESTRATION_UI_POLICY : DIRECT_UI_POLICY}>
        <HomeComposer projects={projects} sessions={sessions} />
      </UiPolicyContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  fakes.start.mockReset().mockResolvedValue(true);
  fakes.create.mockReset();
  fakes.addRepository.mockReset();
  fakes.managed = false;
  fakes.eligible = false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function prompt() {
  return screen.getByRole("textbox", { name: "What should we work on?" });
}

describe("Home composer", () => {
  it("starts a session in the most recent project with the prompt as its first message", async () => {
    mount();
    expect(screen.getByRole("button", { name: "Project: Borealis" })).toBeTruthy();
    fireEvent.change(prompt(), { target: { value: "Fix the flaky test" } });
    fireEvent.keyDown(prompt(), { key: "Enter" });
    await vi.waitFor(() =>
      expect(fakes.start).toHaveBeenCalledWith({
        projectId: "p2",
        behavior: "orchestrator",
        prompt: "Fix the flaky test",
        model: null,
      }),
    );
    await vi.waitFor(() => expect((prompt() as HTMLTextAreaElement).value).toBe(""));
  });

  it("points at the project named in the address and keeps Shift+Enter as a new line", () => {
    mount("/?project=p1");
    expect(screen.getByRole("button", { name: "Project: Atlas" })).toBeTruthy();
    expect(document.activeElement).toBe(prompt());
    fireEvent.change(prompt(), { target: { value: "Line one" } });
    fireEvent.keyDown(prompt(), { key: "Enter", shiftKey: true });
    expect(fakes.start).not.toHaveBeenCalled();
  });

  it("shows the inherited model and the behaviors only where orchestration exists", () => {
    mount("/", false);
    expect(screen.getByRole("button", { name: "Model: glm-5 · high" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Behavior:/ })).toBeNull();
    cleanup();
    mount("/", true);
    expect(screen.getByRole("button", { name: "Behavior: Orchestrator" })).toBeTruthy();
  });

  it("keeps an unsent draft across visits and sends nothing without a prompt", () => {
    mount();
    fireEvent.change(prompt(), { target: { value: "Half a thought" } });
    cleanup();
    mount();
    expect((prompt() as HTMLTextAreaElement).value).toBe("Half a thought");
    fireEvent.change(prompt(), { target: { value: "   " } });
    const send = screen.getByRole("button", { name: "Start session" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("routes an isolated-checkout send through the isolated task form", () => {
    fakes.eligible = true;
    mount("/", false);
    fireEvent.click(screen.getByRole("button", { name: "Isolated checkout" }));
    fireEvent.change(prompt(), { target: { value: "Upgrade the toolchain" } });
    fireEvent.click(screen.getByRole("button", { name: "Set up isolated task" }));
    expect(screen.getByRole("dialog", { name: "New isolated task" }).textContent).toBe(
      "Upgrade the toolchain",
    );
    expect(fakes.start).not.toHaveBeenCalled();
  });

  it("adds a repository from the project picker on a managed host", () => {
    fakes.managed = true;
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Project: Borealis" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add repository…" }));
    expect(fakes.addRepository).toHaveBeenCalledOnce();
    expect(fakes.create).not.toHaveBeenCalled();
  });
});
