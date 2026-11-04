/** @vitest-environment jsdom */

import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManagedGitHubPanel } from "@/app/features/managed/presentation/ManagedGitHubPanel";
import { managedQueryKeys } from "@/app/features/managed/queries";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api, ApiError } from "@/app/services/api";
import type { ManagedGitHubLoginState, ManagedGitHubStatus } from "@/app/types/api";

const connected: ManagedGitHubStatus = {
  configured: true,
  connected: true,
  login: "octocat",
  name: "The Octocat",
  avatar_url: null,
  organization: "arcee-ai",
  expires_at_ms: null,
  git_name: "The Octocat",
  git_email: "octocat@users.noreply.github.com",
  git_configured: true,
};
const disconnected: ManagedGitHubStatus = { ...connected, connected: false };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let client: QueryClient;

function mount(onConnected?: () => void) {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ManagedGitHubPanel onConnected={onConnected} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectConnected() {
  expect(screen.getByText("@octocat")).toBeTruthy();
  expect(screen.getByText("Connected")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reconnect GitHub" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
  expect(screen.queryByTestId("github-device-code")).toBeNull();
}

describe("ManagedGitHubPanel", () => {
  it("keeps a paused initial GitHub check distinct from signed out", async () => {
    const pending = deferred<ManagedGitHubStatus>();
    const get = vi.spyOn(api, "getManagedGitHub").mockReturnValue(pending.promise);
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
      expect(client.getQueryState(managedQueryKeys.github)).toMatchObject({
        status: "pending",
        fetchStatus: "paused",
        data: undefined,
        error: null,
      });
      expect(get).not.toHaveBeenCalled();
      expect(screen.getByRole("status").textContent).toContain("Checking GitHub connection");
      expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(writes.every((write) => write.mock.calls.length === 0)).toBe(true);

      act(() => onlineManager.setOnline(true));
      await waitFor(() => expect(get).toHaveBeenCalledOnce());
      expect(screen.getByRole("status").textContent).toContain("Checking GitHub connection");
      expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
      await act(async () => pending.resolve(disconnected));
      expect(await screen.findByRole("button", { name: "Connect GitHub" })).toBeTruthy();
      expect(client.getQueryState(managedQueryKeys.github)).toMatchObject({
        status: "success",
        fetchStatus: "idle",
        data: { configured: true, connected: false },
      });
      expect(writes.every((write) => write.mock.calls.length === 0)).toBe(true);
    } finally {
      pending.resolve(disconnected);
      view.unmount();
      client.clear();
      act(() => onlineManager.setOnline(wasOnline));
      writes.forEach((write) => write.mockRestore());
    }
  });

  it.each(["initial", "cached"] as const)(
    "retries a denied GitHub status read without offering login: %s",
    async (cache) => {
      const recovered = deferred<ManagedGitHubStatus>();
      const denial = new ApiError(
        403,
        "GET",
        "/managed/github",
        "private denial detail",
        "denied-status",
      );
      const get = vi.spyOn(api, "getManagedGitHub");
      if (cache === "cached") get.mockResolvedValueOnce(connected);
      get.mockRejectedValueOnce(denial).mockReturnValue(recovered.promise);
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
      const view = mount();
      const result = cache === "cached" ? connected : disconnected;
      try {
        if (cache === "cached") {
          await screen.findByText("@octocat");
          expectConnected();
          await act(async () => {
            await client.invalidateQueries({ queryKey: managedQueryKeys.github });
          });
        }
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("GitHub access was denied for this host");
        expect(alert.textContent).not.toContain("private denial detail");
        expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Reconnect GitHub" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
        expect(screen.queryByText("Connected")).toBeNull();
        expect(client.getQueryState(managedQueryKeys.github)).toMatchObject({
          status: "error",
          data: cache === "cached" ? connected : undefined,
        });
        expect(writes.every((write) => write.mock.calls.length === 0)).toBe(true);

        fireEvent.click(screen.getByRole("button", { name: "Retry connection check" }));
        await waitFor(() => expect(get).toHaveBeenCalledTimes(cache === "cached" ? 3 : 2));
        expect(client.getQueryState(managedQueryKeys.github)?.fetchStatus).toBe("fetching");
        expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Reconnect GitHub" })).toBeNull();
        expect(writes.every((write) => write.mock.calls.length === 0)).toBe(true);
        await act(async () => recovered.resolve(result));
        if (cache === "cached") {
          await screen.findByText("@octocat");
          expectConnected();
        } else {
          expect(await screen.findByRole("button", { name: "Connect GitHub" })).toBeTruthy();
          expect(screen.queryByText("Connected")).toBeNull();
        }
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.queryByRole("button", { name: "Retry connection check" })).toBeNull();
        expect(client.getQueryState(managedQueryKeys.github)).toMatchObject({
          status: "success",
          fetchStatus: "idle",
          data: result,
        });
        expect(writes.every((write) => write.mock.calls.length === 0)).toBe(true);
      } finally {
        recovered.resolve(result);
        view.unmount();
        client.clear();
      }
    },
  );

  it("explains a denied GitHub status check without model advice or starting an action", async () => {
    vi.spyOn(api, "getManagedGitHub").mockRejectedValue(
      new ApiError(403, "GET", "/managed/github", "private denial detail", "denied-status"),
    );
    const start = vi.spyOn(api, "startManagedGitHubLogin");
    const disconnect = vi.spyOn(api, "disconnectManagedGitHub");
    mount();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "GitHub access was denied for this host. Ask the host owner to check access to the GitHub App.",
    );
    expect(alert.textContent).not.toMatch(/model|private denial detail/i);
    expect(start).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("keeps an explicit denied login in the GitHub context", async () => {
    vi.spyOn(api, "getManagedGitHub").mockResolvedValue(disconnected);
    const start = vi
      .spyOn(api, "startManagedGitHubLogin")
      .mockRejectedValue(
        new ApiError(403, "POST", "/managed/github/login", "denied", "denied-login"),
      );
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Connect GitHub" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("GitHub access was denied for this host");
    expect(alert.textContent).not.toMatch(/model/i);
    expect(start).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("github-device-code")).toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("shows persistent connected status on reopening and preserves reconnect/disconnect", async () => {
    vi.spyOn(api, "getManagedGitHub").mockResolvedValue(connected);
    const start = vi.spyOn(api, "startManagedGitHubLogin").mockResolvedValue({
      login_id: "reconnect",
      user_code: "ABCD-EFGH",
      verification_uri: "https://github.com/login/device",
      expires_in_secs: 900,
    });
    vi.spyOn(api, "pollManagedGitHubLogin").mockReturnValue(new Promise(() => {}));
    const cancel = vi.spyOn(api, "cancelManagedGitHubLogin").mockResolvedValue(undefined);
    const disconnect = vi.spyOn(api, "disconnectManagedGitHub").mockResolvedValue(disconnected);
    mount();

    await screen.findByText("@octocat");
    expectConnected();
    expect(start).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect GitHub" }));
    await screen.findByTestId("github-device-code");
    expect(start).toHaveBeenCalledOnce();
    const link = screen.getByRole("link", { name: "Open GitHub" });
    expect(link.getAttribute("href")).toBe("https://github.com/login/device");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")?.split(" ")).toEqual(
      expect.arrayContaining(["noopener", "noreferrer"]),
    );
    link.focus();
    expect(document.activeElement).toBe(link);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledWith("reconnect");
    expect(start).toHaveBeenCalledOnce();
    expectConnected();

    vi.mocked(api.getManagedGitHub).mockResolvedValue(disconnected);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await screen.findByRole("button", { name: "Connect GitHub" });
    expect(disconnect).toHaveBeenCalledOnce();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("goes straight from the device prompt to Connected while normalization is pending", async () => {
    const poll = deferred<ManagedGitHubLoginState>();
    const refetch = deferred<ManagedGitHubStatus>();
    const get = vi
      .spyOn(api, "getManagedGitHub")
      .mockResolvedValueOnce(disconnected)
      .mockReturnValue(refetch.promise);
    vi.spyOn(api, "startManagedGitHubLogin").mockResolvedValue({
      login_id: "device-login",
      user_code: "ABCD-EFGH",
      verification_uri: "https://github.com/login/device",
      expires_in_secs: 900,
    });
    vi.spyOn(api, "pollManagedGitHubLogin").mockReturnValue(poll.promise);
    const onConnected = vi.fn();
    mount(onConnected);
    const invalidate = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(await screen.findByRole("button", { name: "Connect GitHub" }));
    await screen.findByTestId("github-device-code");
    const disconnectedFrames: string[] = [];
    const observer = new MutationObserver(() => {
      if (screen.queryByRole("button", { name: "Connect GitHub" })) {
        disconnectedFrames.push("Connect GitHub reappeared");
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    try {
      await act(async () => poll.resolve({ state: "complete", auth: connected }));
      await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
      expectConnected();
      expect(client.isFetching({ queryKey: managedQueryKeys.github })).toBe(1);
      expect(screen.getByText("GitHub connected")).toBeTruthy();
      expect(onConnected).toHaveBeenCalledOnce();
      expect(invalidate).toHaveBeenCalledWith({ queryKey: managedQueryKeys.github });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: managedQueryKeys.hostStatus });

      await act(async () => refetch.resolve({ ...connected, name: "Normalized profile" }));
      await screen.findByText("Normalized profile");
      expectConnected();
      expect(disconnectedFrames).toEqual([]);
    } finally {
      observer.disconnect();
    }
  });
});
