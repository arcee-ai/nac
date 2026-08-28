/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManagedRepositoryModal } from "@/app/features/managed/presentation/ManagedRepositoryModal";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import type { ManagedGitHubRepository } from "@/app/types/api";

const repositories: ManagedGitHubRepository[] = [
  {
    id: 1,
    name: "first",
    full_name: "arcee-ai/first",
    private: true,
    can_read: true,
    can_write: true,
    default_branch: "first-default",
    clone_url: "https://github.com/arcee-ai/first.git",
    html_url: "https://github.com/arcee-ai/first",
  },
  {
    id: 2,
    name: "second",
    full_name: "arcee-ai/second",
    private: true,
    can_read: true,
    can_write: true,
    default_branch: "second-default",
    clone_url: "https://github.com/arcee-ai/second.git",
    html_url: "https://github.com/arcee-ai/second",
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const fakes = {
  status: vi.fn(),
  github: vi.fn(),
  repositories: vi.fn(),
  branches: vi.fn(),
};

vi.spyOn(api, "getManagedStatus").mockImplementation((...args) => fakes.status(...args));
vi.spyOn(api, "getManagedGitHub").mockImplementation((...args) => fakes.github(...args));
vi.spyOn(api, "listManagedGitHubRepositories").mockImplementation((...args) =>
  fakes.repositories(...args),
);
vi.spyOn(api, "listManagedGitHubBranches").mockImplementation((...args) => fakes.branches(...args));

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <ManagedRepositoryModal open onClose={() => {}} onConnect={() => {}} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fakes.status.mockReset().mockResolvedValue({ repository_root: "/repositories" });
  fakes.github.mockReset().mockResolvedValue({ connected: true });
  fakes.repositories.mockReset().mockResolvedValue({ repositories });
  fakes.branches.mockReset();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("managed repository branch lifecycle", () => {
  it("initializes the repository default and ignores stale branch responses", async () => {
    const first = deferred<{ branches: string[] }>();
    const second = deferred<{ branches: string[] }>();
    fakes.branches.mockImplementation((_owner: string, repository: string) =>
      repository === "first" ? first.promise : second.promise,
    );
    mount();

    fireEvent.click(await screen.findByRole("button", { name: /arcee-ai\/first/ }));
    expect(screen.getByRole("button", { name: "Branch: first-default" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /arcee-ai\/second/ }));
    const trigger = screen.getByRole("button", { name: "Branch: second-default" });
    fireEvent.click(trigger);
    expect(screen.getByRole("status").textContent).toContain("Loading branches");

    await waitFor(() => expect(fakes.branches).toHaveBeenCalledTimes(2));
    await act(async () => {
      first.resolve({ branches: ["first-default", "first-only"] });
      await first.promise;
    });
    expect(screen.queryByRole("option", { name: "first-only" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Loading branches");

    second.resolve({ branches: ["second-default", "second-only"] });
    expect(await screen.findByRole("option", { name: "second-only" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "first-only" })).toBeNull();
  });
});
