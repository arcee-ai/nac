/** @vitest-environment jsdom */

import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManagedRepositoryModal } from "@/app/features/managed/presentation/ManagedRepositoryModal";
import { managedQueryKeys } from "@/app/features/managed/queries";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api, ApiError } from "@/app/services/api";
import type { ManagedCloneOperation, ManagedGitHubRepository } from "@/app/types/api";

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

const privateDenials = [
  "private denial detail",
  "invalid model configuration: private denial detail",
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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
    defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
  });
  const contents = (open: boolean) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <ManagedRepositoryModal open={open} onClose={() => {}} onConnect={() => {}} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(contents(true));
  return { ...view, client, setOpen: (open: boolean) => view.rerender(contents(open)) };
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
  it.each(privateDenials)("keeps an initial GitHub denial in context: %s", async (detail) => {
    fakes.github
      .mockRejectedValueOnce(new ApiError(403, "GET", "/managed/github", detail, "denied-read"))
      .mockResolvedValue({ connected: true });
    const start = vi.spyOn(api, "startManagedClone");
    const login = vi.spyOn(api, "startManagedGitHubLogin");
    const disconnect = vi.spyOn(api, "disconnectManagedGitHub");
    const view = mount();
    try {
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(
        "GitHub access was denied for this host. Ask the host owner to check access to the GitHub App.",
      );
      expect(alert.textContent).not.toMatch(/model|private denial detail/i);
      expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
      expect(screen.queryByRole("textbox", { name: "Find repository" })).toBeNull();
      const clone = screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" });
      expect(clone.disabled).toBe(true);
      fireEvent.click(clone);
      expect(fakes.github).toHaveBeenCalledTimes(1);
      expect(fakes.repositories).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();
      expect(disconnect).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Retry connection check" }));
      expect(await screen.findByRole("button", { name: /arcee-ai\/first/ })).toBeTruthy();
      expect(fakes.github).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(start).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();
      expect(disconnect).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      view.client.clear();
      start.mockRestore();
      login.mockRestore();
      disconnect.mockRestore();
    }
  });

  it.each(privateDenials)(
    "keeps a cached GitHub denial and checkout draft in context: %s",
    async (detail) => {
      fakes.branches.mockResolvedValue({ branches: ["first-default", "topic/saved"] });
      const start = vi.spyOn(api, "startManagedClone");
      const login = vi.spyOn(api, "startManagedGitHubLogin");
      const disconnect = vi.spyOn(api, "disconnectManagedGitHub");
      const view = mount();
      try {
        fireEvent.click(await screen.findByRole("button", { name: /arcee-ai\/first/ }));
        fireEvent.click(screen.getByRole("button", { name: "Branch: first-default" }));
        fireEvent.click(await screen.findByRole("option", { name: "topic/saved" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
          target: { value: "Retained Project" },
        });
        fireEvent.change(screen.getByRole("textbox", { name: "Checkout directory" }), {
          target: { value: "retained-checkout" },
        });
        fakes.github.mockRejectedValueOnce(
          new ApiError(403, "GET", "/managed/github", detail, "denied-refresh"),
        );
        await act(async () => {
          await view.client.invalidateQueries({ queryKey: managedQueryKeys.github });
        });
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("GitHub access was denied for this host");
        expect(alert.textContent).not.toMatch(/model|private denial detail/i);
        expect(view.client.getQueryData(managedQueryKeys.github)).toEqual({ connected: true });
        expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
        expect(screen.queryByRole("textbox", { name: "Checkout directory" })).toBeNull();
        const clone = screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" });
        expect(clone.disabled).toBe(true);
        fireEvent.click(clone);
        expect(fakes.github).toHaveBeenCalledTimes(2);
        expect(start).not.toHaveBeenCalled();
        expect(login).not.toHaveBeenCalled();
        expect(disconnect).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Retry connection check" }));
        expect(await screen.findByRole("button", { name: "Branch: topic/saved" })).toBeTruthy();
        expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" }).value).toBe(
          "Retained Project",
        );
        expect(
          screen.getByRole<HTMLInputElement>("textbox", { name: "Checkout directory" }).value,
        ).toBe("retained-checkout");
        expect(
          screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" }).disabled,
        ).toBe(false);
        expect(screen.queryByRole("alert")).toBeNull();
        expect(fakes.github).toHaveBeenCalledTimes(3);
        expect(start).not.toHaveBeenCalled();
        expect(login).not.toHaveBeenCalled();
        expect(disconnect).not.toHaveBeenCalled();
      } finally {
        view.unmount();
        view.client.clear();
        start.mockRestore();
        login.mockRestore();
        disconnect.mockRestore();
      }
    },
  );

  it("keeps a paused initial GitHub check distinct from signed out", async () => {
    const pending = deferred<{ configured: boolean; connected: boolean }>();
    fakes.github.mockReturnValue(pending.promise);
    const writes = [
      vi.spyOn(api, "startManagedClone"),
      vi.spyOn(api, "cancelManagedClone"),
      vi.spyOn(api, "startManagedGitHubLogin"),
      vi.spyOn(api, "cancelManagedGitHubLogin"),
      vi.spyOn(api, "disconnectManagedGitHub"),
      vi.spyOn(api, "startManagedUpgrade"),
      vi.spyOn(api, "putManagedSecret"),
      vi.spyOn(api, "deleteManagedSecret"),
    ];
    const wasOnline = onlineManager.isOnline();
    act(() => onlineManager.setOnline(false));
    const view = mount();
    try {
      expect(view.client.getQueryState(managedQueryKeys.github)).toMatchObject({
        status: "pending",
        fetchStatus: "paused",
        data: undefined,
        error: null,
      });
      expect(fakes.github).not.toHaveBeenCalled();
      expect(screen.getByRole("status").textContent).toContain("Checking GitHub connection");
      expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(fakes.repositories).not.toHaveBeenCalled();
      const clone = screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" });
      expect(clone.disabled).toBe(true);
      fireEvent.click(clone);
      expect(writes.every((write) => write.mock.calls.length === 0)).toBe(true);

      act(() => onlineManager.setOnline(true));
      await waitFor(() => expect(fakes.github).toHaveBeenCalledOnce());
      expect(screen.getByRole("status").textContent).toContain("Checking GitHub connection");
      expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
      await act(async () => pending.resolve({ configured: true, connected: false }));
      expect(await screen.findByRole("button", { name: "Connect GitHub" })).toBeTruthy();
      expect(view.client.getQueryState(managedQueryKeys.github)).toMatchObject({
        status: "success",
        fetchStatus: "idle",
        data: { configured: true, connected: false },
      });
      expect(clone.disabled).toBe(true);
      expect(fakes.repositories).not.toHaveBeenCalled();
      expect(writes.every((write) => write.mock.calls.length === 0)).toBe(true);
    } finally {
      pending.resolve({ configured: true, connected: false });
      view.unmount();
      view.client.clear();
      act(() => onlineManager.setOnline(wasOnline));
      writes.forEach((write) => write.mockRestore());
    }
  });

  it("names a pending connection without offering a premature connect action", async () => {
    const pending = deferred<{ connected: boolean }>();
    fakes.github.mockReturnValue(pending.promise);
    mount();
    expect(screen.getByRole("status").textContent).toContain("Checking GitHub connection");
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
    expect(fakes.repositories).not.toHaveBeenCalled();
    pending.resolve({ connected: false });
    expect(await screen.findByRole("button", { name: "Connect GitHub" })).toBeTruthy();
  });

  it("keeps a failed connection check distinct from signed out and retries the read only", async () => {
    fakes.github.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ connected: true });
    fakes.branches.mockResolvedValue({ branches: ["first-default"] });
    const start = vi.spyOn(api, "startManagedClone");
    mount();
    const retry = await screen.findByRole("button", { name: "Retry connection check" });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(await screen.findByRole("button", { name: /arcee-ai\/first/ })).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
    start.mockRestore();
  });

  it("keeps cached connection failures unavailable and restores the checkout draft after retry", async () => {
    fakes.branches.mockResolvedValue({ branches: ["first-default", "topic/saved"] });
    const start = vi.spyOn(api, "startManagedClone");
    const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: /arcee-ai\/first/ }));
    fireEvent.click(screen.getByRole("button", { name: "Branch: first-default" }));
    fireEvent.click(await screen.findByRole("option", { name: "topic/saved" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
      target: { value: "Retained Project" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Checkout directory" }), {
      target: { value: "retained-checkout" },
    });

    fakes.github.mockRejectedValueOnce(new Error("offline during connection refresh"));
    await act(async () => {
      await view.client.invalidateQueries({ queryKey: managedQueryKeys.github });
    });
    const retry = await screen.findByRole("button", { name: "Retry connection check" });
    expect(screen.getByRole("alert").textContent).toContain("Offline during connection refresh");
    expect(view.client.getQueryData(managedQueryKeys.github)).toEqual({ connected: true });
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Find repository" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Checkout directory" })).toBeNull();
    const clone = screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" });
    expect(clone.disabled).toBe(true);
    fireEvent.click(clone);
    expect(start).not.toHaveBeenCalled();

    fireEvent.click(retry);
    expect(await screen.findByRole("button", { name: "Branch: topic/saved" })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" }).value).toBe(
      "Retained Project",
    );
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Checkout directory" }).value,
    ).toBe("retained-checkout");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" }).disabled,
    ).toBe(false);
    expect(start).not.toHaveBeenCalled();
    start.mockRestore();
  });

  it("retains a pending clone and running cancellation when the connection refresh fails", async () => {
    fakes.branches.mockResolvedValue({ branches: ["first-default"] });
    const launch = deferred<ManagedCloneOperation>();
    const running: ManagedCloneOperation = {
      version: 1,
      operation_id: "clone-owned",
      status: "running",
      repository_id: 1,
      repository: "arcee-ai/first",
      source_identity: "github:1:arcee-ai/first",
      branch: "first-default",
      destination: "/repositories/first",
      project_id: "project-owned",
      project_name: "first",
      progress: "Cloning retained operation",
      error: null,
      reused_existing_checkout: false,
      created_at_unix_ms: 1,
      updated_at_unix_ms: 1,
    };
    const start = vi.spyOn(api, "startManagedClone").mockReturnValue(launch.promise);
    const cancel = vi.spyOn(api, "cancelManagedClone").mockResolvedValue({
      ...running,
      status: "cancelled",
      progress: "Retained clone cancelled",
    });
    const poll = vi.spyOn(api, "getManagedClone").mockResolvedValue(running);
    const view = mount();
    try {
      fireEvent.click(await screen.findByRole("button", { name: /arcee-ai\/first/ }));
      await waitFor(() =>
        expect(
          screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" }).disabled,
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: "Clone repository" }));
      expect(start).toHaveBeenCalledTimes(1);
      fakes.github.mockRejectedValueOnce(new Error("offline while clone starts"));
      await act(async () => {
        await view.client.invalidateQueries({ queryKey: managedQueryKeys.github });
      });
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Offline while clone starts",
      );
      expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
      expect(view.client.getQueryData(managedQueryKeys.github)).toEqual({ connected: true });

      vi.useFakeTimers();
      await act(async () => {
        launch.resolve(running);
        await launch.promise;
      });
      expect(screen.getByText("Cloning retained operation")).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Cancel clone" }));
      });
      expect(cancel).toHaveBeenCalledExactlyOnceWith("clone-owned");
      expect(screen.getByRole("status").textContent).toBe("Clone cancelled");
      expect(screen.getByText("Retained clone cancelled")).toBeTruthy();
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" }).disabled,
      ).toBe(true);
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      view.client.clear();
      vi.clearAllTimers();
      vi.useRealTimers();
      start.mockRestore();
      cancel.mockRestore();
      poll.mockRestore();
    }
  });

  it("keeps a newer disconnected status when an older connection read finishes later", async () => {
    fakes.branches.mockResolvedValue({ branches: ["first-default"] });
    const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: /arcee-ai\/first/ }));
    const older = deferred<{ connected: boolean }>();
    const newer = deferred<{ connected: boolean }>();
    fakes.github.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    let first!: Promise<void>;
    act(() => {
      first = view.client.invalidateQueries({ queryKey: managedQueryKeys.github });
    });
    await waitFor(() => expect(fakes.github).toHaveBeenCalledTimes(2));
    let second!: Promise<void>;
    act(() => {
      second = view.client.invalidateQueries({ queryKey: managedQueryKeys.github });
    });
    await waitFor(() => expect(fakes.github).toHaveBeenCalledTimes(3));
    await act(async () => {
      newer.resolve({ connected: false });
      await second;
    });
    expect(await screen.findByRole("button", { name: "Connect GitHub" })).toBeTruthy();
    await act(async () => {
      older.resolve({ connected: true });
      await first;
    });
    expect(view.client.getQueryData(managedQueryKeys.github)).toEqual({ connected: false });
    expect(screen.queryByRole("textbox", { name: "Find repository" })).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" }).disabled,
    ).toBe(true);
  });

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

  const recoveryCases = (["repositories", "branches", "both"] as const).flatMap((dependency) =>
    privateDenials.map((detail) => ({ dependency, detail })),
  );
  const copyCases = (["repositories", "branches"] as const).flatMap((dependency) =>
    privateDenials.map((detail) => ({ dependency, detail })),
  );
  const repositoryKey = ["managed-github-repositories"];
  const branchKey = ["managed-github-branches", "arcee-ai/first"];
  const denied = (path: string, detail: string) =>
    new ApiError(403, "GET", path, detail, "dependent-denied");
  const observeWrites = () => [
    vi.spyOn(api, "startManagedClone").mockRejectedValue(new Error("Unexpected clone write")),
    vi
      .spyOn(api, "cancelManagedClone")
      .mockRejectedValue(new Error("Unexpected clone cancellation")),
    vi.spyOn(api, "startManagedGitHubLogin").mockRejectedValue(new Error("Unexpected login write")),
    vi
      .spyOn(api, "cancelManagedGitHubLogin")
      .mockRejectedValue(new Error("Unexpected login cancellation")),
    vi.spyOn(api, "disconnectManagedGitHub").mockRejectedValue(new Error("Unexpected disconnect")),
    vi.spyOn(api, "startManagedUpgrade").mockRejectedValue(new Error("Unexpected upgrade")),
    vi.spyOn(api, "putManagedSecret").mockRejectedValue(new Error("Unexpected secret write")),
    vi.spyOn(api, "deleteManagedSecret").mockRejectedValue(new Error("Unexpected secret deletion")),
  ];

  it.each(recoveryCases)(
    "recovers failed dependent reads after one connection Retry: $dependency / $detail",
    async ({ dependency, detail }) => {
      fakes.branches.mockResolvedValue({ branches: ["first-default", "topic/saved"] });
      const writes = observeWrites();
      const wasOnline = onlineManager.isOnline();
      const view = mount();
      const githubFailure = deferred<{ connected: boolean }>();
      const repositoryFailure = deferred<{ repositories: ManagedGitHubRepository[] }>();
      const branchFailure = deferred<{ branches: string[] }>();
      const recoveredRepositories = deferred<{ repositories: ManagedGitHubRepository[] }>();
      const recoveredBranches = deferred<{ branches: string[] }>();
      const failRepositories = dependency !== "branches";
      const failBranches = dependency !== "repositories";
      try {
        fireEvent.click(await screen.findByRole("button", { name: /arcee-ai\/first/ }));
        fireEvent.click(screen.getByRole("button", { name: "Branch: first-default" }));
        fireEvent.click(await screen.findByRole("option", { name: "topic/saved" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
          target: { value: "Retained dependency draft" },
        });
        fireEvent.change(screen.getByRole("textbox", { name: "Checkout directory" }), {
          target: { value: "retained-dependency-checkout" },
        });
        fakes.github.mockReturnValueOnce(githubFailure.promise);
        if (failRepositories) fakes.repositories.mockReturnValueOnce(repositoryFailure.promise);
        if (failBranches) fakes.branches.mockReturnValueOnce(branchFailure.promise);
        // The test client deliberately uses staleTime0. The browser proposal
        // separately waits the real production30s before public reconnect.
        act(() => onlineManager.setOnline(false));
        act(() => onlineManager.setOnline(true));
        await waitFor(() => {
          expect(fakes.github).toHaveBeenCalledTimes(2);
          expect(fakes.repositories).toHaveBeenCalledTimes(2);
          expect(fakes.branches).toHaveBeenCalledTimes(2);
        });
        await act(async () => {
          if (failRepositories)
            repositoryFailure.reject(denied("/managed/github/repositories", detail));
          if (failBranches)
            branchFailure.reject(
              denied("/managed/github/repositories/arcee-ai/first/branches", detail),
            );
          githubFailure.reject(denied("/managed/github", detail));
          await Promise.allSettled([
            githubFailure.promise,
            ...(failRepositories ? [repositoryFailure.promise] : []),
            ...(failBranches ? [branchFailure.promise] : []),
          ]);
        });
        await waitFor(() => {
          expect(view.client.getQueryState(managedQueryKeys.github)?.status).toBe("error");
          if (failRepositories)
            expect(view.client.getQueryState(repositoryKey)?.status).toBe("error");
          if (failBranches) expect(view.client.getQueryState(branchKey)?.status).toBe("error");
        });
        expect(view.client.getQueryData(managedQueryKeys.github)).toEqual({ connected: true });
        expect(screen.queryByRole("textbox", { name: "Checkout directory" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
        const clone = screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" });
        expect(clone.disabled).toBe(true);
        fireEvent.click(clone);
        expect(screen.getByRole("alert").textContent).not.toMatch(
          /model|private denial detail|workspace/i,
        );
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());

        fakes.repositories.mockReturnValueOnce(recoveredRepositories.promise);
        fakes.branches.mockReturnValueOnce(recoveredBranches.promise);
        fireEvent.click(screen.getByRole("button", { name: "Retry connection check" }));
        // This is the RED recovery oracle: connection-only Retry on413 never
        // starts either retained dependent key again. Do not clear those keys.
        await waitFor(() => {
          expect(fakes.github).toHaveBeenCalledTimes(3);
          expect(fakes.repositories).toHaveBeenCalledTimes(3);
          expect(fakes.branches).toHaveBeenCalledTimes(3);
        });
        expect(view.client.getQueryState(repositoryKey)?.fetchStatus).toBe("fetching");
        expect(view.client.getQueryState(branchKey)?.fetchStatus).toBe("fetching");
        expect(screen.getByRole("status").textContent).toContain("Loading repositories");
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" }).value).toBe(
          "Retained dependency draft",
        );
        expect(
          screen.getByRole<HTMLInputElement>("textbox", { name: "Checkout directory" }).value,
        ).toBe("retained-dependency-checkout");
        fireEvent.click(screen.getByRole("button", { name: "Branch: topic/saved" }));
        expect(
          screen
            .getAllByRole("status")
            .some((status) => status.textContent?.includes("Loading branches")),
        ).toBe(true);
        await act(async () => {
          recoveredRepositories.resolve({ repositories });
          recoveredBranches.resolve({
            branches: ["first-default", "topic/saved", "topic/recovered"],
          });
          await Promise.all([recoveredRepositories.promise, recoveredBranches.promise]);
        });
        expect(await screen.findByRole("option", { name: "topic/recovered" })).toBeTruthy();
        expect(
          screen.getByRole("option", { name: "topic/saved" }).getAttribute("aria-selected"),
        ).toBe("true");
        expect(screen.queryByRole("alert")).toBeNull();
        expect(
          screen.getByRole("button", { name: /arcee-ai\/first/ }).getAttribute("aria-pressed"),
        ).toBe("true");
        expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" }).value).toBe(
          "Retained dependency draft",
        );
        expect(
          screen.getByRole<HTMLInputElement>("textbox", { name: "Checkout directory" }).value,
        ).toBe("retained-dependency-checkout");
        expect(fakes.github).toHaveBeenCalledTimes(3);
        expect(fakes.repositories).toHaveBeenCalledTimes(3);
        expect(fakes.branches).toHaveBeenCalledTimes(3);
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
      } finally {
        githubFailure.resolve({ connected: true });
        repositoryFailure.resolve({ repositories });
        branchFailure.resolve({ branches: ["first-default"] });
        recoveredRepositories.resolve({ repositories });
        recoveredBranches.resolve({ branches: ["first-default", "topic/saved"] });
        view.unmount();
        view.client.clear();
        onlineManager.setOnline(wasOnline);
        writes.forEach((write) => write.mockRestore());
      }
    },
  );

  it.each(copyCases)(
    "keeps dependent GitHub denials in context: $dependency / $detail",
    async ({ dependency, detail }) => {
      if (dependency === "repositories")
        fakes.repositories.mockRejectedValue(denied("/managed/github/repositories", detail));
      else
        fakes.branches.mockRejectedValue(
          denied("/managed/github/repositories/arcee-ai/first/branches", detail),
        );
      const writes = observeWrites();
      const view = mount();
      try {
        if (dependency === "branches") {
          fireEvent.click(await screen.findByRole("button", { name: /arcee-ai\/first/ }));
          fireEvent.click(screen.getByRole("button", { name: "Branch: first-default" }));
        }
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toBe(
          "GitHub access was denied for this host. Ask the host owner to check access to the GitHub App.",
        );
        expect(alert.textContent).not.toMatch(
          /model|private denial detail|workspace|configuration/i,
        );
        expect(fakes.github).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
      } finally {
        view.unmount();
        view.client.clear();
        writes.forEach((write) => write.mockRestore());
      }
    },
  );

  it.each(["repositories", "branches", "both"] as const)(
    "supersedes an older dependent reconnect read after connection Retry: %s",
    async (dependency) => {
      fakes.branches.mockResolvedValue({ branches: ["first-default", "topic/saved"] });
      const writes = observeWrites();
      const wasOnline = onlineManager.isOnline();
      const view = mount();
      const githubFailure = deferred<{ connected: boolean }>();
      const oldRepositories = deferred<{ repositories: ManagedGitHubRepository[] }>();
      const oldBranches = deferred<{ branches: string[] }>();
      const freshRepositories = deferred<{ repositories: ManagedGitHubRepository[] }>();
      const freshBranches = deferred<{ branches: string[] }>();
      const signals: AbortSignal[] = [];
      const pendingRepositories = dependency !== "branches";
      const pendingBranches = dependency !== "repositories";
      try {
        fireEvent.click(await screen.findByRole("button", { name: /arcee-ai\/first/ }));
        fireEvent.click(screen.getByRole("button", { name: "Branch: first-default" }));
        fireEvent.click(await screen.findByRole("option", { name: "topic/saved" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
          target: { value: "Owned pending draft" },
        });
        fireEvent.change(screen.getByRole("textbox", { name: "Checkout directory" }), {
          target: { value: "owned-pending-checkout" },
        });
        fakes.github.mockReturnValueOnce(githubFailure.promise);
        if (pendingRepositories)
          fakes.repositories.mockImplementationOnce((signal: AbortSignal) => {
            signals.push(signal);
            return oldRepositories.promise;
          });
        if (pendingBranches)
          fakes.branches.mockImplementationOnce(
            (_owner: string, _repository: string, signal: AbortSignal) => {
              signals.push(signal);
              return oldBranches.promise;
            },
          );
        act(() => onlineManager.setOnline(false));
        act(() => onlineManager.setOnline(true));
        await waitFor(() => {
          expect(fakes.github).toHaveBeenCalledTimes(2);
          expect(fakes.repositories).toHaveBeenCalledTimes(2);
          expect(fakes.branches).toHaveBeenCalledTimes(2);
        });
        await act(async () => {
          githubFailure.reject(denied("/managed/github", privateDenials[1]!));
          await Promise.allSettled([githubFailure.promise]);
        });
        expect(await screen.findByRole("button", { name: "Retry connection check" })).toBeTruthy();
        expect(signals).toHaveLength(dependency === "both" ? 2 : 1);
        expect(signals.every((signal) => !signal.aborted)).toBe(true);
        fakes.repositories.mockReturnValueOnce(freshRepositories.promise);
        fakes.branches.mockReturnValueOnce(freshBranches.promise);
        fireEvent.click(screen.getByRole("button", { name: "Retry connection check" }));
        await waitFor(() => {
          expect(fakes.github).toHaveBeenCalledTimes(3);
          expect(fakes.repositories).toHaveBeenCalledTimes(3);
          expect(fakes.branches).toHaveBeenCalledTimes(3);
        });
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        await act(async () => {
          freshRepositories.resolve({ repositories });
          freshBranches.resolve({ branches: ["first-default", "topic/saved", "topic/newer"] });
          await Promise.all([freshRepositories.promise, freshBranches.promise]);
        });
        await waitFor(() => expect(view.client.getQueryState(branchKey)?.status).toBe("success"));
        await act(async () => {
          if (pendingRepositories)
            oldRepositories.reject(denied("/managed/github/repositories", privateDenials[1]!));
          if (pendingBranches)
            oldBranches.reject(
              denied("/managed/github/repositories/arcee-ai/first/branches", privateDenials[1]!),
            );
          await Promise.allSettled([
            ...(pendingRepositories ? [oldRepositories.promise] : []),
            ...(pendingBranches ? [oldBranches.promise] : []),
          ]);
        });
        expect(view.client.getQueryState(repositoryKey)?.status).toBe("success");
        expect(view.client.getQueryState(branchKey)?.status).toBe("success");
        expect(view.client.getQueryData<{ branches: string[] }>(branchKey)?.branches).toContain(
          "topic/newer",
        );
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByRole("button", { name: "Branch: topic/saved" })).toBeTruthy();
        expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" }).value).toBe(
          "Owned pending draft",
        );
        expect(
          screen.getByRole<HTMLInputElement>("textbox", { name: "Checkout directory" }).value,
        ).toBe("owned-pending-checkout");
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
      } finally {
        githubFailure.resolve({ connected: true });
        oldRepositories.resolve({ repositories });
        oldBranches.resolve({ branches: ["first-default"] });
        freshRepositories.resolve({ repositories });
        freshBranches.resolve({ branches: ["first-default", "topic/saved"] });
        view.unmount();
        view.client.clear();
        onlineManager.setOnline(wasOnline);
        writes.forEach((write) => write.mockRestore());
      }
    },
  );

  const primeReadyCheckout = async () => {
    fireEvent.click(await screen.findByRole("button", { name: /arcee-ai\/first/ }));
    fireEvent.click(screen.getByRole("button", { name: "Branch: first-default" }));
    fireEvent.click(await screen.findByRole("option", { name: "topic/saved" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
      target: { value: "Owned readiness draft" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Checkout directory" }), {
      target: { value: "owned-readiness-checkout" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" }).disabled,
      ).toBe(false),
    );
  };
  const failReadyConnection = async (view: ReturnType<typeof mount>) => {
    fakes.github.mockRejectedValueOnce(denied("/managed/github", privateDenials[1]!));
    await act(async () => {
      await view.client.invalidateQueries({ queryKey: managedQueryKeys.github });
    });
    expect(await screen.findByRole("button", { name: "Retry connection check" })).toBeTruthy();
  };

  it.each(["repositories", "branches"] as const)(
    "gates Clone through explicit dependent readiness recovery: %s fails",
    async (failed) => {
      fakes.branches.mockResolvedValue({ branches: ["first-default", "topic/saved"] });
      const writes = observeWrites();
      const view = mount();
      const repo = deferred<{ repositories: ManagedGitHubRepository[] }>();
      const branches = deferred<{ branches: string[] }>();
      try {
        await primeReadyCheckout();
        await failReadyConnection(view);
        fakes.repositories.mockReturnValueOnce(repo.promise);
        fakes.branches.mockReturnValueOnce(branches.promise);
        fireEvent.click(screen.getByRole("button", { name: "Retry connection check" }));
        await waitFor(() => {
          expect(view.client.getQueryState(repositoryKey)?.fetchStatus).toBe("fetching");
          expect(view.client.getQueryState(branchKey)?.fetchStatus).toBe("fetching");
          expect(view.client.getQueryState(managedQueryKeys.github)?.status).toBe("success");
        });
        const clone = screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" });
        expect(clone.disabled).toBe(true);
        fireEvent.click(clone);
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
        await act(async () => {
          if (failed === "repositories")
            branches.resolve({ branches: ["first-default", "topic/saved"] });
          else repo.resolve({ repositories });
        });
        expect(clone.disabled).toBe(true);
        await act(async () => {
          if (failed === "repositories") {
            repo.reject(denied("/managed/github/repositories", privateDenials[1]!));
            await Promise.allSettled([repo.promise]);
          } else {
            branches.reject(
              denied("/managed/github/repositories/arcee-ai/first/branches", privateDenials[1]!),
            );
            await Promise.allSettled([branches.promise]);
          }
        });
        expect(clone.disabled).toBe(true);
        fireEvent.click(clone);
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
        const retry = await screen.findByRole("button", { name: "Retry repository checks" });
        fireEvent.click(retry);
        await waitFor(() => expect(clone.disabled).toBe(false));
        expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" }).value).toBe(
          "Owned readiness draft",
        );
        expect(
          screen.getByRole<HTMLInputElement>("textbox", { name: "Checkout directory" }).value,
        ).toBe("owned-readiness-checkout");
        expect(screen.getByRole("button", { name: "Branch: topic/saved" })).toBeTruthy();
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
        await act(async () => {
          fireEvent.click(clone);
        });
        expect(writes[0]).toHaveBeenCalledExactlyOnceWith({
          repository_id: 1,
          repository: "arcee-ai/first",
          branch: "topic/saved",
          destination: "owned-readiness-checkout",
          project_name: "Owned readiness draft",
          project_description: null,
        });
        writes.slice(1).forEach((write) => expect(write).not.toHaveBeenCalled());
      } finally {
        repo.resolve({ repositories });
        branches.resolve({ branches: ["first-default", "topic/saved"] });
        view.unmount();
        view.client.clear();
        writes.forEach((write) => write.mockRestore());
      }
    },
  );

  it("binds Clone readiness to the newer repository and preserves newer branch drafts", async () => {
    fakes.branches.mockResolvedValue({ branches: ["first-default", "topic/saved"] });
    const writes = observeWrites();
    const view = mount();
    const repo = deferred<{ repositories: ManagedGitHubRepository[] }>();
    const oldBranch = deferred<{ branches: string[] }>();
    const newBranch = deferred<{ branches: string[] }>();
    try {
      await primeReadyCheckout();
      await failReadyConnection(view);
      fakes.repositories.mockReturnValueOnce(repo.promise);
      fakes.branches.mockReturnValueOnce(oldBranch.promise);
      fireEvent.click(screen.getByRole("button", { name: "Retry connection check" }));
      await waitFor(() => expect(fakes.branches).toHaveBeenCalledTimes(2));
      fakes.branches.mockReturnValueOnce(newBranch.promise);
      fireEvent.click(screen.getByRole("button", { name: /arcee-ai\/second/ }));
      fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
        target: { value: "Newer Project" },
      });
      fireEvent.change(screen.getByRole("textbox", { name: "Checkout directory" }), {
        target: { value: "newer-checkout" },
      });
      const clone = screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" });
      expect(clone.disabled).toBe(true);
      await act(async () => {
        repo.resolve({ repositories });
        await repo.promise;
      });
      expect(clone.disabled).toBe(true);
      await act(async () => {
        newBranch.resolve({ branches: ["second-default", "second/topic"] });
        await newBranch.promise;
      });
      fireEvent.click(screen.getByRole("button", { name: "Branch: second-default" }));
      fireEvent.click(await screen.findByRole("option", { name: "second/topic" }));
      await waitFor(() => expect(clone.disabled).toBe(false));
      await act(async () => {
        oldBranch.resolve({ branches: ["first-default", "stale/old"] });
        await oldBranch.promise;
      });
      expect(screen.getByRole("button", { name: "Branch: second/topic" })).toBeTruthy();
      expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" }).value).toBe(
        "Newer Project",
      );
      expect(
        screen.getByRole<HTMLInputElement>("textbox", { name: "Checkout directory" }).value,
      ).toBe("newer-checkout");
      expect(clone.disabled).toBe(false);
      writes.forEach((write) => expect(write).not.toHaveBeenCalled());
    } finally {
      repo.resolve({ repositories });
      oldBranch.resolve({ branches: [] });
      newBranch.resolve({ branches: [] });
      view.unmount();
      view.client.clear();
      writes.forEach((write) => write.mockRestore());
    }
  });

  it("does not carry an older connection Retry into a closed and reopened lifetime", async () => {
    fakes.branches.mockResolvedValue({ branches: ["first-default", "topic/saved"] });
    const writes = observeWrites();
    const view = mount();
    const oldGitHub = deferred<{ connected: boolean }>();
    const repo = deferred<{ repositories: ManagedGitHubRepository[] }>();
    const branches = deferred<{ branches: string[] }>();
    try {
      await primeReadyCheckout();
      await failReadyConnection(view);
      fakes.github.mockReturnValueOnce(oldGitHub.promise);
      fireEvent.click(screen.getByRole("button", { name: "Retry connection check" }));
      await waitFor(() => expect(fakes.github).toHaveBeenCalledTimes(3));
      act(() => view.setOpen(false));
      act(() => view.setOpen(true));
      // Re-enabling staleTime0 observers legitimately performs one ordinary
      // reopen read; the obsolete Retry must not add another dependent read.
      await waitFor(() => {
        expect(fakes.repositories).toHaveBeenCalledTimes(2);
        expect(fakes.branches).toHaveBeenCalledTimes(2);
      });
      await act(async () => {
        await view.client.invalidateQueries({ queryKey: managedQueryKeys.github });
      });
      await waitFor(() =>
        expect(view.client.getQueryState(managedQueryKeys.github)?.status).toBe("success"),
      );
      expect(fakes.repositories).toHaveBeenCalledTimes(2);
      expect(fakes.branches).toHaveBeenCalledTimes(2);
      await failReadyConnection(view);
      fakes.repositories.mockReturnValueOnce(repo.promise);
      fakes.branches.mockReturnValueOnce(branches.promise);
      fireEvent.click(screen.getByRole("button", { name: "Retry connection check" }));
      await waitFor(() =>
        expect(view.client.getQueryState(repositoryKey)?.fetchStatus).toBe("fetching"),
      );
      await act(async () => {
        oldGitHub.resolve({ connected: false });
        await oldGitHub.promise;
      });
      const clone = screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" });
      expect(clone.disabled).toBe(true);
      expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
      await act(async () => {
        repo.resolve({ repositories });
        branches.resolve({ branches: ["first-default", "topic/saved"] });
        await Promise.all([repo.promise, branches.promise]);
      });
      await waitFor(() => expect(clone.disabled).toBe(false));
      expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" }).value).toBe(
        "Owned readiness draft",
      );
      writes.forEach((write) => expect(write).not.toHaveBeenCalled());
    } finally {
      oldGitHub.resolve({ connected: true });
      repo.resolve({ repositories });
      branches.resolve({ branches: [] });
      view.unmount();
      view.client.clear();
      writes.forEach((write) => write.mockRestore());
    }
  });

  it.each(["pointer", "keyboard"] as const)(
    "retains cached branch choices after failed repository recovery (%s)",
    async (input) => {
      fakes.branches.mockResolvedValue({ branches: ["first-default", "topic/saved"] });
      const writes = observeWrites();
      const view = mount();
      const failedRepositories = deferred<{ repositories: ManagedGitHubRepository[] }>();
      const recoveredBranches = deferred<{ branches: string[] }>();
      const ordinaryBranches = deferred<{ branches: string[] }>();
      try {
        await primeReadyCheckout();
        await failReadyConnection(view);
        fakes.repositories.mockReturnValueOnce(failedRepositories.promise);
        fakes.branches.mockReturnValueOnce(recoveredBranches.promise);
        fireEvent.click(screen.getByRole("button", { name: "Retry connection check" }));
        await waitFor(() => {
          expect(view.client.getQueryState(repositoryKey)?.fetchStatus).toBe("fetching");
          expect(view.client.getQueryState(branchKey)?.fetchStatus).toBe("fetching");
          expect(view.client.getQueryState(managedQueryKeys.github)?.status).toBe("success");
        });
        const clone = screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" });
        expect(clone.disabled).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: "Branch: topic/saved" }));
        expect(screen.getByText("Loading branches…", { exact: true })).toBeTruthy();
        await act(async () => {
          recoveredBranches.resolve({ branches: ["first-default", "topic/saved"] });
          failedRepositories.reject(denied("/managed/github/repositories", privateDenials[1]!));
          await Promise.allSettled([recoveredBranches.promise, failedRepositories.promise]);
        });
        await waitFor(() => {
          expect(view.client.getQueryState(repositoryKey)?.status).toBe("error");
          expect(view.client.getQueryState(repositoryKey)?.fetchStatus).toBe("idle");
          expect(view.client.getQueryState(branchKey)?.status).toBe("success");
          expect(view.client.getQueryState(branchKey)?.fetchStatus).toBe("idle");
        });
        expect(clone.disabled).toBe(true);
        expect(screen.getByRole("alert").textContent).not.toMatch(
          /model|private denial detail|workspace/i,
        );
        const search = screen.getByRole<HTMLInputElement>("combobox", { name: "Find branch" });
        fireEvent.change(search, { target: { value: "first-" } });
        fakes.branches.mockReturnValueOnce(ordinaryBranches.promise);
        let refresh!: Promise<unknown>;
        act(() => {
          refresh = view.client.invalidateQueries({ queryKey: branchKey });
        });
        await waitFor(() => {
          expect(view.client.getQueryState(branchKey)?.fetchStatus).toBe("fetching");
          expect(view.client.getQueryState(branchKey)?.status).toBe("success");
          expect(view.client.getQueryState(repositoryKey)?.status).toBe("error");
        });
        expect(clone.disabled).toBe(true);
        expect(search.value).toBe("first-");
        expect(screen.queryByText("Loading branches…", { exact: true })).toBeNull();
        const option = screen.getByRole("option", { name: "first-default" });
        expect(screen.getAllByRole("option")).toHaveLength(1);
        expect(search.getAttribute("aria-activedescendant")).toBe(option.id);
        if (input === "pointer") fireEvent.click(option);
        else fireEvent.keyDown(search, { key: "Enter" });
        expect(screen.getByRole("button", { name: "Branch: first-default" })).toBeTruthy();
        expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" }).value).toBe(
          "Owned readiness draft",
        );
        expect(
          screen.getByRole<HTMLInputElement>("textbox", { name: "Checkout directory" }).value,
        ).toBe("owned-readiness-checkout");
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
        await act(async () => {
          ordinaryBranches.resolve({ branches: ["first-default", "topic/saved"] });
          await refresh;
        });
        expect(clone.disabled).toBe(true);
        expect(await screen.findByRole("button", { name: "Retry repository checks" })).toBeTruthy();
        fireEvent.click(clone);
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
      } finally {
        failedRepositories.resolve({ repositories });
        recoveredBranches.resolve({ branches: ["first-default", "topic/saved"] });
        ordinaryBranches.resolve({ branches: ["first-default", "topic/saved"] });
        view.unmount();
        view.client.clear();
        writes.forEach((write) => write.mockRestore());
      }
    },
  );

  it.each(["pointer", "keyboard"] as const)(
    "keeps healthy ordinary background refresh available without a connection Retry (%s)",
    async (input) => {
      fakes.branches.mockResolvedValue({ branches: ["first-default", "topic/saved"] });
      const writes = observeWrites();
      const view = mount();
      const repo = deferred<{ repositories: ManagedGitHubRepository[] }>();
      const branches = deferred<{ branches: string[] }>();
      try {
        await primeReadyCheckout();
        fireEvent.click(screen.getByRole("button", { name: "Branch: topic/saved" }));
        const search = screen.getByRole<HTMLInputElement>("combobox", { name: "Find branch" });
        fireEvent.change(search, { target: { value: "first-" } });
        expect(screen.getByRole("option", { name: "first-default" })).toBeTruthy();

        fakes.repositories.mockReturnValueOnce(repo.promise);
        fakes.branches.mockReturnValueOnce(branches.promise);
        let refresh!: Promise<unknown>;
        act(() => {
          refresh = Promise.all([
            view.client.invalidateQueries({ queryKey: repositoryKey }),
            view.client.invalidateQueries({ queryKey: branchKey }),
          ]);
        });
        await waitFor(() => {
          expect(view.client.getQueryState(repositoryKey)?.fetchStatus).toBe("fetching");
          expect(view.client.getQueryState(branchKey)?.fetchStatus).toBe("fetching");
        });
        expect(
          screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" }).disabled,
        ).toBe(false);
        expect(search.value).toBe("first-");
        expect(screen.queryByText("Loading branches…", { exact: true })).toBeNull();
        const option = screen.getByRole("option", { name: "first-default" });
        expect(screen.getAllByRole("option")).toHaveLength(1);
        expect(search.getAttribute("aria-activedescendant")).toBe(option.id);
        if (input === "pointer") fireEvent.click(option);
        else fireEvent.keyDown(search, { key: "Enter" });
        expect(screen.getByRole("button", { name: "Branch: first-default" })).toBeTruthy();
        expect(screen.queryByRole("listbox")).toBeNull();
        expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" }).value).toBe(
          "Owned readiness draft",
        );
        expect(
          screen.getByRole<HTMLInputElement>("textbox", { name: "Checkout directory" }).value,
        ).toBe("owned-readiness-checkout");
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
        await act(async () => {
          repo.resolve({ repositories });
          branches.resolve({ branches: ["first-default", "topic/saved"] });
          await refresh;
        });
        expect(screen.getByRole("button", { name: "Branch: first-default" })).toBeTruthy();
        expect(
          screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" }).disabled,
        ).toBe(false);
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
      } finally {
        repo.resolve({ repositories });
        branches.resolve({ branches: [] });
        view.unmount();
        view.client.clear();
        writes.forEach((write) => write.mockRestore());
      }
    },
  );

  it("repository cache presentation distinguishes initial fetching, empty, search and error", async () => {
    const pending = deferred<{ repositories: ManagedGitHubRepository[] }>();
    fakes.repositories.mockReturnValueOnce(pending.promise);
    const writes = observeWrites();
    const view = mount();
    try {
      expect(await screen.findByText("Loading repositories…")).toBeTruthy();
      expect(view.client.getQueryState(repositoryKey)).toMatchObject({
        status: "pending",
        fetchStatus: "fetching",
        data: undefined,
      });
      expect(screen.queryByText("No repositories match.")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      await act(async () => pending.resolve({ repositories: [] }));
      expect(await screen.findByText("No repositories match.")).toBeTruthy();
      expect(screen.queryByText("Loading repositories…")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();

      await act(async () => {
        await view.client.invalidateQueries({ queryKey: repositoryKey });
      });
      expect(await screen.findByRole("button", { name: /arcee-ai\/first/ })).toBeTruthy();
      const search = screen.getByRole<HTMLInputElement>("textbox", { name: "Find repository" });
      fireEvent.change(search, { target: { value: "no-such-repository" } });
      expect(screen.getByText("No repositories match.")).toBeTruthy();
      expect(view.client.getQueryData(repositoryKey)).toEqual({ repositories });
      fireEvent.change(search, { target: { value: "" } });
      fakes.repositories.mockRejectedValueOnce(
        denied("/managed/github/repositories", privateDenials[1]!),
      );
      await act(async () => {
        await view.client.invalidateQueries({ queryKey: repositoryKey });
      });
      expect((await screen.findByRole("alert")).textContent).toContain(
        "GitHub access was denied for this host",
      );
      expect(screen.getByRole("button", { name: /arcee-ai\/first/ })).toBeTruthy();
      expect(screen.queryByText("Loading repositories…")).toBeNull();
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" }).disabled,
      ).toBe(true);
      writes.forEach((write) => expect(write).not.toHaveBeenCalled());
    } finally {
      pending.resolve({ repositories: [] });
      view.unmount();
      view.client.clear();
      writes.forEach((write) => write.mockRestore());
    }
  });

  it.each(["rows", "empty", "error"] as const)(
    "repository cache presentation retains cached %s during an ordinary refresh",
    async (cache) => {
      fakes.branches.mockResolvedValue({ branches: ["first-default", "topic/saved"] });
      const writes = observeWrites();
      const view = mount();
      const ordinary = deferred<{ repositories: ManagedGitHubRepository[] }>();
      try {
        await primeReadyCheckout();
        if (cache !== "rows") {
          if (cache === "empty") fakes.repositories.mockResolvedValueOnce({ repositories: [] });
          else
            fakes.repositories.mockRejectedValueOnce(
              denied("/managed/github/repositories", privateDenials[1]!),
            );
          await act(async () => {
            await view.client.invalidateQueries({ queryKey: repositoryKey });
          });
          if (cache === "empty") await screen.findByText("No repositories match.");
          else await screen.findByRole("alert");
        }
        const search = screen.getByRole<HTMLInputElement>("textbox", { name: "Find repository" });
        fireEvent.change(search, { target: { value: "arcee-ai/first" } });
        const clone = screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" });
        const wasDisabled = clone.disabled;
        expect(wasDisabled).toBe(cache === "error");
        fakes.repositories.mockReturnValueOnce(ordinary.promise);
        let refresh!: Promise<unknown>;
        act(() => {
          refresh = view.client.invalidateQueries({ queryKey: repositoryKey });
        });
        await waitFor(() => {
          expect(view.client.getQueryState(repositoryKey)?.fetchStatus).toBe("fetching");
          expect(view.client.getQueryState(repositoryKey)?.status).toBe(
            cache === "error" ? "error" : "success",
          );
        });
        expect(screen.queryByText("Loading repositories…")).toBeNull();
        if (cache === "empty") expect(screen.getByText("No repositories match.")).toBeTruthy();
        else expect(screen.getByRole("button", { name: /arcee-ai\/first/ })).toBeTruthy();
        if (cache === "error") {
          expect(screen.getByRole("alert").textContent).toContain(
            "GitHub access was denied for this host",
          );
          expect(screen.getByRole("alert").textContent).not.toMatch(/model|private denial detail/i);
          expect(screen.queryByRole("button", { name: "Retry repository checks" })).toBeNull();
          fireEvent.click(clone);
        } else expect(screen.queryByRole("alert")).toBeNull();
        expect(clone.disabled).toBe(wasDisabled);
        expect(search.value).toBe("arcee-ai/first");
        expect(screen.getByRole("button", { name: "Branch: topic/saved" })).toBeTruthy();
        expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" }).value).toBe(
          "Owned readiness draft",
        );
        expect(
          screen.getByRole<HTMLInputElement>("textbox", { name: "Checkout directory" }).value,
        ).toBe("owned-readiness-checkout");
        expect(fakes.github).toHaveBeenCalledOnce();
        expect(fakes.branches).toHaveBeenCalledOnce();
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
        await act(async () => {
          if (cache === "error") {
            ordinary.reject(denied("/managed/github/repositories", privateDenials[1]!));
            await Promise.allSettled([ordinary.promise]);
          } else ordinary.resolve({ repositories: cache === "empty" ? [] : repositories });
          await refresh;
        });
        if (cache === "error")
          expect(
            await screen.findByRole("button", { name: "Retry repository checks" }),
          ).toBeTruthy();
        expect(clone.disabled).toBe(wasDisabled);
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
      } finally {
        ordinary.resolve({ repositories });
        view.unmount();
        view.client.clear();
        writes.forEach((write) => write.mockRestore());
      }
    },
  );

  it("repository cache presentation retains a failed recovery error through an ordinary refresh", async () => {
    fakes.branches.mockResolvedValue({ branches: ["first-default", "topic/saved"] });
    const writes = observeWrites();
    const view = mount();
    const failed = deferred<{ repositories: ManagedGitHubRepository[] }>();
    const branches = deferred<{ branches: string[] }>();
    const ordinary = deferred<{ repositories: ManagedGitHubRepository[] }>();
    try {
      await primeReadyCheckout();
      await failReadyConnection(view);
      fakes.repositories.mockReturnValueOnce(failed.promise);
      fakes.branches.mockReturnValueOnce(branches.promise);
      fireEvent.click(screen.getByRole("button", { name: "Retry connection check" }));
      await waitFor(() => {
        expect(view.client.getQueryState(repositoryKey)?.fetchStatus).toBe("fetching");
        expect(view.client.getQueryState(branchKey)?.fetchStatus).toBe("fetching");
      });
      expect(screen.getByText("Loading repositories…")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      const clone = screen.getByRole<HTMLButtonElement>("button", { name: "Clone repository" });
      expect(clone.disabled).toBe(true);
      await act(async () => {
        branches.resolve({ branches: ["first-default", "topic/saved"] });
        failed.reject(denied("/managed/github/repositories", privateDenials[1]!));
        await Promise.allSettled([branches.promise, failed.promise]);
      });
      expect(await screen.findByRole("button", { name: "Retry repository checks" })).toBeTruthy();
      fakes.repositories.mockReturnValueOnce(ordinary.promise);
      let refresh!: Promise<unknown>;
      act(() => {
        refresh = view.client.invalidateQueries({ queryKey: repositoryKey });
      });
      await waitFor(() => {
        expect(view.client.getQueryState(repositoryKey)?.fetchStatus).toBe("fetching");
        expect(view.client.getQueryState(repositoryKey)?.status).toBe("error");
      });
      expect(screen.queryByText("Loading repositories…")).toBeNull();
      expect(screen.getByRole("alert").textContent).toContain(
        "GitHub access was denied for this host",
      );
      expect(screen.queryByRole("button", { name: "Retry repository checks" })).toBeNull();
      expect(clone.disabled).toBe(true);
      fireEvent.click(clone);
      writes.forEach((write) => expect(write).not.toHaveBeenCalled());
      await act(async () => {
        ordinary.resolve({ repositories });
        await refresh;
      });
      await waitFor(() => expect(clone.disabled).toBe(false));
      expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" }).value).toBe(
        "Owned readiness draft",
      );
      expect(
        screen.getByRole<HTMLInputElement>("textbox", { name: "Checkout directory" }).value,
      ).toBe("owned-readiness-checkout");
      expect(fakes.github).toHaveBeenCalledTimes(3);
      expect(fakes.repositories).toHaveBeenCalledTimes(3);
      expect(fakes.branches).toHaveBeenCalledTimes(2);
      writes.forEach((write) => expect(write).not.toHaveBeenCalled());
    } finally {
      failed.resolve({ repositories });
      branches.resolve({ branches: [] });
      ordinary.resolve({ repositories });
      view.unmount();
      view.client.clear();
      writes.forEach((write) => write.mockRestore());
    }
  });

  it.each(privateDenials)(
    "denial message alert leaves Retry outside live text: %s",
    async (detail) => {
      fakes.github
        .mockRejectedValueOnce(denied("/managed/github", detail))
        .mockResolvedValue({ connected: true });
      const writes = observeWrites();
      const view = mount();
      try {
        const alert = await screen.findByRole("alert");
        const retry = screen.getByRole<HTMLButtonElement>("button", {
          name: "Retry connection check",
        });
        expect(alert.tagName).toBe("P");
        expect(alert.textContent).toBe(
          "GitHub access was denied for this host. Ask the host owner to check access to the GitHub App.",
        );
        expect(alert.querySelector("button")).toBeNull();
        expect(retry.closest('[role="alert"]')).toBeNull();
        retry.focus();
        expect(document.activeElement).toBe(retry);
        expect(writes.every((write) => write.mock.calls.length === 0)).toBe(true);
        fireEvent.click(retry);
        expect(await screen.findByRole("button", { name: /arcee-ai\/first/ })).toBeTruthy();
        expect(fakes.github).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole("alert")).toBeNull();
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
      } finally {
        view.unmount();
        view.client.clear();
        writes.forEach((write) => write.mockRestore());
      }
    },
  );
});
