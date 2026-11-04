/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManagedGitHubPanel } from "@/app/features/managed/presentation/ManagedGitHubPanel";
import { managedQueryKeys } from "@/app/features/managed/queries";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
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
