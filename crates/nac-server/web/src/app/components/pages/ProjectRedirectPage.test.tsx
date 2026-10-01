/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProjectRedirectPage from "@/app/components/pages/ProjectRedirectPage";
import { atomRefresh, isolatedRegistry } from "@/app/effect/remote";
import { apiEffect } from "@/app/services/api";
import { projectsAtom, SESSIONS_POLL_MS, sessionsAtom } from "@/app/services/queries";
import type { ProjectList } from "@/app/types/api";

vi.mock("@/app/providers/ProjectActionsProvider", () => ({
  useProjectActions: () => ({ newChat: fakes.newChat }),
}));

const fakes = vi.hoisted(() => ({
  newChat: vi.fn(),
  projects: vi.fn(),
  sessions: vi.fn(),
}));

vi.spyOn(apiEffect, "listProjects").mockImplementation(() =>
  Effect.promise(() => fakes.projects()),
);
vi.spyOn(apiEffect, "listSessions").mockImplementation(() =>
  Effect.promise(() => fakes.sessions()),
);

const originalRefresh = atomRefresh.run.bind(atomRefresh);

function mount(seed?: (registry: ReturnType<typeof isolatedRegistry>) => void) {
  const registry = isolatedRegistry();
  seed?.(registry);
  const view = render(
    <RegistryContext.Provider value={registry}>
      <MemoryRouter initialEntries={["/project/project-1"]}>
        <Routes>
          <Route path="/project/:projectId" element={<ProjectRedirectPage />} />
        </Routes>
      </MemoryRouter>
    </RegistryContext.Provider>,
  );
  return { registry, view };
}

beforeEach(() => {
  fakes.newChat.mockReset().mockResolvedValue(undefined);
  fakes.projects.mockReset().mockResolvedValue({ projects: [{ project_id: "project-1" }] });
  fakes.sessions.mockReset().mockResolvedValue([]);
  vi.spyOn(atomRefresh, "run").mockImplementation((registry, atom) =>
    originalRefresh(registry, atom),
  );
});

afterEach(() => {
  cleanup();
  if (vi.isMockFunction(atomRefresh.run)) atomRefresh.run.mockRestore();
});

describe("project redirect", () => {
  it("starts the first chat only after both ownership queries succeed", async () => {
    const { registry } = mount();
    await waitFor(() => expect(fakes.newChat).toHaveBeenCalledOnce());
    expect(fakes.newChat).toHaveBeenCalledWith("project-1", true);
    expect(atomRefresh.run).toHaveBeenCalledWith(registry, projectsAtom);
    expect(atomRefresh.run).toHaveBeenCalledWith(registry, sessionsAtom(SESSIONS_POLL_MS));
  });

  it("does not create a chat when the session ownership query fails", async () => {
    fakes.sessions.mockRejectedValue(new Error("sessions failed"));
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakes.newChat).not.toHaveBeenCalled();
  });

  it("does not create a chat when the project ownership query fails", async () => {
    fakes.projects.mockRejectedValue(new Error("projects failed"));
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakes.newChat).not.toHaveBeenCalled();
  });

  it("does not create a chat while ownership queries are paused before success", async () => {
    fakes.sessions.mockReturnValue(new Promise(() => {}));
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakes.newChat).not.toHaveBeenCalled();
  });

  it("does not create a chat from stale successful ownership data during refetch", async () => {
    fakes.sessions.mockReturnValue(new Promise(() => {}));
    mount((registry) => {
      registry.set(
        projectsAtom,
        AsyncResult.success({ projects: [{ project_id: "project-1" }] } as ProjectList),
      );
      registry.set(sessionsAtom(SESSIONS_POLL_MS), AsyncResult.success([], { waiting: true }));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakes.newChat).not.toHaveBeenCalled();
  });

  it("does not open the required first-chat dialog until a fresh ownership read completes", async () => {
    const gate = Promise.withResolvers<void>();
    vi.mocked(atomRefresh.run).mockImplementation(async (registry, atom) => {
      await originalRefresh(registry, atom);
      if (atom === sessionsAtom(SESSIONS_POLL_MS)) await gate.promise;
    });
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakes.newChat).not.toHaveBeenCalled();
    gate.resolve();
    await waitFor(() => expect(fakes.newChat).toHaveBeenCalledWith("project-1", true));
  });
});
