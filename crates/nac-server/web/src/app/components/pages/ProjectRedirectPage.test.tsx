/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProjectRedirectPage from "@/app/components/pages/ProjectRedirectPage";

const fakes = vi.hoisted(() => ({
  newChat: vi.fn(),
  projects: vi.fn(),
  sessions: vi.fn(),
}));

vi.mock("@/app/providers/ProjectActionsProvider", () => ({
  useProjectActions: () => ({ newChat: fakes.newChat }),
}));

vi.mock("@/app/services/queries", () => ({
  useProjects: () => fakes.projects(),
  useSessions: () => fakes.sessions(),
}));

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/project/project-1"]}>
        <Routes>
          <Route path="/project/:projectId" element={<ProjectRedirectPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fakes.newChat.mockReset().mockResolvedValue(undefined);
  fakes.projects.mockReset().mockReturnValue({
    data: { projects: [{ project_id: "project-1" }] },
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: true,
  });
  fakes.sessions.mockReset().mockReturnValue({
    data: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: true,
  });
});

afterEach(cleanup);

describe("project redirect", () => {
  it("starts the first chat only after both ownership queries succeed", async () => {
    mount();
    await waitFor(() => expect(fakes.newChat).toHaveBeenCalledOnce());
    expect(fakes.newChat).toHaveBeenCalledWith("project-1");
  });

  it("does not create a chat when the session ownership query fails", async () => {
    fakes.sessions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      isSuccess: false,
    });
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakes.newChat).not.toHaveBeenCalled();
  });

  it("does not create a chat when the project ownership query fails", async () => {
    fakes.projects.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      isSuccess: false,
    });
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakes.newChat).not.toHaveBeenCalled();
  });

  it("does not create a chat while ownership queries are paused before success", async () => {
    fakes.sessions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      isSuccess: false,
    });
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakes.newChat).not.toHaveBeenCalled();
  });

  it("does not create a chat from stale successful ownership data during refetch", async () => {
    fakes.sessions.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: true,
      isError: false,
      isSuccess: true,
    });
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakes.newChat).not.toHaveBeenCalled();
  });
});
