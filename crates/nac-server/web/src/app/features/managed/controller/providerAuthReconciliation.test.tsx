/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { useDeviceLogin } from "@/app/features/managed/controller/useDeviceLogin";
import { api } from "@/app/services/api";
import { queryKeys, useManagedLogout, useModelCatalog } from "@/app/services/queries";
import type { ModelCatalog } from "@/app/types/api";

function catalog(ready: boolean): ModelCatalog {
  return {
    catalog_version: 1,
    providers: [
      {
        id: "chatgpt-codex-responses",
        auth: "codex_oauth",
        auth_status: ready ? "ready" : "no_credential",
        auth_hint: ready ? null : "Sign in with ChatGPT",
        connection: ready
          ? { base_url: "https://chatgpt.com/backend-api", api_key_env: null }
          : null,
        default_base_url: null,
        managed_base_url: "https://chatgpt.com/backend-api/codex",
        default_limits: { context_window: 128000, max_tokens: 4096, supported_efforts: [] },
        models: [],
      },
    ],
  };
}

function wrapper(client: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("refetches the unified catalog when device login becomes ready", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("open", vi.fn());
  const getCatalog = vi
    .spyOn(api, "getModelCatalog")
    .mockResolvedValueOnce(catalog(false))
    .mockResolvedValue(catalog(true));
  vi.spyOn(api, "startManagedLogin").mockResolvedValue({
    provider: "codex",
    login_id: "login-1",
    verification_uri: "https://example.test/device",
    user_code: "ABCD",
    expires_in_secs: 600,
  });
  vi.spyOn(api, "pollManagedLogin").mockResolvedValue({
    state: "complete",
    auth: {
      provider: "codex",
      backend: "chatgpt-codex-responses",
      base_url: "https://chatgpt.com/backend-api/codex",
      signed_in: true,
      account: "test@example.com",
      organization: null,
      expires_at_ms: null,
      path: "/server-owned/auth.json",
    },
  });
  vi.spyOn(api, "listManagedAuth").mockResolvedValue({ providers: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(() => ({ catalog: useModelCatalog(), login: useDeviceLogin() }), {
    wrapper: wrapper(client),
  });

  try {
    await vi.waitFor(() => expect(hook.result.current.catalog.data).toEqual(catalog(false)));
    await act(async () => hook.result.current.login.start("codex"));
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    await vi.waitFor(() => {
      expect(hook.result.current.catalog.data).toEqual(catalog(true));
      expect(getCatalog).toHaveBeenCalledTimes(2);
    });
  } finally {
    hook.unmount();
    client.clear();
  }
});

it("refetches the unified catalog when logout removes readiness", async () => {
  const getCatalog = vi
    .spyOn(api, "getModelCatalog")
    .mockResolvedValueOnce(catalog(true))
    .mockResolvedValue(catalog(false));
  vi.spyOn(api, "managedLogout").mockResolvedValue({
    provider: "codex",
    backend: "chatgpt-codex-responses",
    base_url: null,
    signed_in: false,
    account: null,
    organization: null,
    expires_at_ms: null,
    path: "/server-owned/auth.json",
  });
  vi.spyOn(api, "listManagedAuth").mockResolvedValue({ providers: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(() => ({ catalog: useModelCatalog(), logout: useManagedLogout() }), {
    wrapper: wrapper(client),
  });

  try {
    await waitFor(() => expect(hook.result.current.catalog.data).toEqual(catalog(true)));
    await act(async () => {
      await hook.result.current.logout.mutateAsync("codex");
    });
    await waitFor(() => {
      expect(client.getQueryData(queryKeys.modelCatalog)).toEqual(catalog(false));
      expect(getCatalog).toHaveBeenCalledTimes(2);
    });
  } finally {
    hook.unmount();
    client.clear();
  }
});

it("does not open a provider tab or cancel the durable login when its view detaches during start", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof api.startManagedLogin>>>();
  vi.spyOn(api, "startManagedLogin").mockReturnValue(pending.promise);
  const cancel = vi.spyOn(api, "cancelManagedLogin").mockResolvedValue(undefined);
  vi.spyOn(api, "pollManagedLogin").mockResolvedValue({ state: "pending" });
  const open = vi.fn();
  vi.stubGlobal("open", open);
  const client = new QueryClient();
  const hook = renderHook(() => useDeviceLogin(), { wrapper: wrapper(client) });
  let starting: Promise<void> | undefined;
  act(() => {
    starting = hook.result.current.start("codex");
  });
  hook.unmount();
  pending.resolve({
    provider: "codex",
    login_id: "late",
    verification_uri: "https://example.test/device",
    user_code: "ABCD",
    expires_in_secs: 600,
  });
  await starting;
  expect(open).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  client.clear();
});

it("explicit cancellation during start cancels the eventual server identity exactly once", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof api.startManagedLogin>>>();
  const begin = vi.spyOn(api, "startManagedLogin").mockReturnValue(pending.promise);
  const cancel = vi.spyOn(api, "cancelManagedLogin").mockResolvedValue(undefined);
  const open = vi.fn();
  vi.stubGlobal("open", open);
  const client = new QueryClient();
  const hook = renderHook(() => useDeviceLogin(), { wrapper: wrapper(client) });
  let starting: Promise<void> | undefined;
  act(() => {
    starting = hook.result.current.start("codex");
  });
  await act(async () => {
    await hook.result.current.start("codex");
    await hook.result.current.cancel();
  });
  await act(async () => {
    pending.resolve({
      provider: "codex",
      login_id: "cancelled",
      verification_uri: "https://example.test/device",
      user_code: "ABCD",
      expires_in_secs: 600,
    });
    await starting;
  });
  expect(begin).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledExactlyOnceWith("codex", "cancelled");
  expect(hook.result.current.state.status).toBe("idle");
  expect(open).not.toHaveBeenCalled();
  hook.unmount();
  client.clear();
});

it("settles host readiness and catalog after a completed observation detaches, without a late success callback", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof api.pollManagedLogin>>>();
  vi.stubGlobal("open", vi.fn());
  vi.spyOn(api, "startManagedLogin").mockResolvedValue({
    provider: "codex",
    login_id: "origin",
    verification_uri: "https://example.test/device",
    user_code: "ABCD",
    expires_in_secs: 600,
  });
  const poll = vi.spyOn(api, "pollManagedLogin").mockReturnValue(pending.promise);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const success = vi.fn();
  const hook = renderHook(() => useDeviceLogin(success), { wrapper: wrapper(client) });
  await act(async () => {
    await hook.result.current.start("codex");
  });
  await waitFor(() => expect(poll).toHaveBeenCalled());
  const signal = poll.mock.calls[0]?.[2];
  hook.unmount();
  expect(signal?.aborted).toBe(false);
  pending.resolve({ state: "complete", auth: { provider: "codex", signed_in: true } } as Awaited<
    ReturnType<typeof api.pollManagedLogin>
  >);
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.managedHostStatus }),
  );
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.modelCatalog });
  expect(success).not.toHaveBeenCalled();
  client.clear();
});

it("retains a signal-aware provider observation after presentation detach", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof api.pollManagedLogin>>>();
  vi.stubGlobal("open", vi.fn());
  vi.spyOn(api, "startManagedLogin").mockResolvedValue({
    provider: "codex",
    login_id: "signal-aware",
    verification_uri: "https://example.test/device",
    user_code: "ABCD",
    expires_in_secs: 600,
  });
  const poll = vi.spyOn(api, "pollManagedLogin").mockImplementation((_provider, _id, signal) => {
    signal?.addEventListener(
      "abort",
      () => pending.reject(new DOMException("aborted", "AbortError")),
      { once: true },
    );
    return pending.promise;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const success = vi.fn();
  const hook = renderHook(() => useDeviceLogin(success), { wrapper: wrapper(client) });
  try {
    await act(async () => hook.result.current.start("codex"));
    await waitFor(() => expect(poll).toHaveBeenCalledTimes(1));
    const signal = poll.mock.calls[0]?.[2];
    hook.unmount();
    expect(signal?.aborted).toBe(false);
    pending.resolve({ state: "complete", auth: { provider: "codex", signed_in: true } } as Awaited<
      ReturnType<typeof api.pollManagedLogin>
    >);
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.modelCatalog }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.managedHostStatus });
    expect(success).not.toHaveBeenCalled();
  } finally {
    hook.unmount();
    client.clear();
  }
});

it("reuses a pending provider flow when the disclosure reopens", async () => {
  vi.stubGlobal("open", vi.fn());
  const begin = vi.spyOn(api, "startManagedLogin").mockResolvedValue({
    provider: "codex",
    login_id: "reopen",
    verification_uri: "https://example.test/device",
    user_code: "ABCD",
    expires_in_secs: 600,
  });
  vi.spyOn(api, "pollManagedLogin").mockResolvedValue({ state: "pending" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const first = renderHook(() => useDeviceLogin(), { wrapper: wrapper(client) });
  let reopened: typeof first | undefined;
  try {
    await act(async () => first.result.current.start("codex"));
    await waitFor(() => expect(first.result.current.state.status).toBe("waiting"));
    first.unmount();
    reopened = renderHook(() => useDeviceLogin(), { wrapper: wrapper(client) });
    await act(async () => reopened!.result.current.start("codex"));
    expect(begin).toHaveBeenCalledTimes(1);
    expect(reopened.result.current.state.status).toBe("waiting");
  } finally {
    first.unmount();
    reopened?.unmount();
    client.clear();
  }
});

it("aborts operation observation when its origin QueryClient is disposed without cancelling server login", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof api.pollManagedLogin>>>();
  vi.stubGlobal("open", vi.fn());
  vi.spyOn(api, "startManagedLogin").mockResolvedValue({
    provider: "codex",
    login_id: "dispose",
    verification_uri: "https://example.test/device",
    user_code: "ABCD",
    expires_in_secs: 600,
  });
  const poll = vi.spyOn(api, "pollManagedLogin").mockImplementation((_provider, _id, signal) => {
    signal?.addEventListener(
      "abort",
      () => pending.reject(new DOMException("aborted", "AbortError")),
      { once: true },
    );
    return pending.promise;
  });
  const cancel = vi.spyOn(api, "cancelManagedLogin").mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const hook = renderHook(() => useDeviceLogin(), { wrapper: wrapper(client) });
  await act(async () => hook.result.current.start("codex"));
  await waitFor(() => expect(poll).toHaveBeenCalledTimes(1));
  hook.unmount();
  client.clear();
  expect(poll.mock.calls[0]?.[2]?.aborted).toBe(true);
  expect(cancel).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
});

it("keeps provider attempts independent and resumes their presentation without a second start", async () => {
  vi.stubGlobal("open", vi.fn());
  const begin = vi.spyOn(api, "startManagedLogin").mockImplementation(async (provider) => ({
    provider,
    login_id: provider,
    verification_uri: "https://example.test/device",
    user_code: provider,
    expires_in_secs: 600,
  }));
  const signals = new Map<string, AbortSignal | undefined>();
  vi.spyOn(api, "pollManagedLogin").mockImplementation((provider, _id, signal) => {
    signals.set(provider, signal);
    return new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
        once: true,
      });
    });
  });
  const cancel = vi.spyOn(api, "cancelManagedLogin").mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const codex = renderHook(() => useDeviceLogin(undefined, "codex"), { wrapper: wrapper(client) });
  const arcee = renderHook(() => useDeviceLogin(undefined, "arcee"), { wrapper: wrapper(client) });
  let resumed: typeof codex | undefined;
  try {
    await act(async () => {
      await codex.result.current.start("codex");
      await arcee.result.current.start("arcee");
    });
    await waitFor(() => expect(signals.size).toBe(2));
    codex.unmount();
    resumed = renderHook(() => useDeviceLogin(undefined, "codex"), { wrapper: wrapper(client) });
    expect(resumed.result.current.state.status).toBe("waiting");
    if (resumed.result.current.state.status === "waiting")
      expect(resumed.result.current.state.prompt.provider).toBe("codex");
    await act(async () => resumed!.result.current.start("codex"));
    expect(begin).toHaveBeenCalledTimes(2);
    await act(async () => resumed!.result.current.cancel());
    expect(cancel).toHaveBeenCalledExactlyOnceWith("codex", "codex");
    expect(signals.get("codex")?.aborted).toBe(true);
    expect(signals.get("arcee")?.aborted).toBe(false);
    expect(arcee.result.current.state.status).toBe("waiting");
  } finally {
    codex.unmount();
    arcee.unmount();
    resumed?.unmount();
    client.clear();
  }
});

it("suppresses a delayed provider tab after the visible provider changes", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof api.startManagedLogin>>>();
  vi.spyOn(api, "startManagedLogin").mockReturnValue(pending.promise);
  vi.spyOn(api, "pollManagedLogin").mockResolvedValue({ state: "pending" });
  const open = vi.fn();
  vi.stubGlobal("open", open);
  const client = new QueryClient();
  const hook = renderHook(
    ({ provider }: { provider: "codex" | "arcee" }) => useDeviceLogin(undefined, provider),
    {
      wrapper: wrapper(client),
      initialProps: { provider: "codex" },
    },
  );
  let starting: Promise<void> | undefined;
  act(() => {
    starting = hook.result.current.start("codex");
  });
  hook.rerender({ provider: "arcee" });
  await act(async () => {
    pending.resolve({
      provider: "codex",
      login_id: "previous",
      verification_uri: "https://example.test/device",
      user_code: "ABCD",
      expires_in_secs: 600,
    });
    await starting;
  });
  expect(open).not.toHaveBeenCalled();
  expect(hook.result.current.state.status).toBe("idle");
  hook.unmount();
  client.clear();
});

it("fences a late completion that ignores abort after origin disposal", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof api.pollManagedLogin>>>();
  vi.stubGlobal("open", vi.fn());
  vi.spyOn(api, "startManagedLogin").mockResolvedValue({
    provider: "codex",
    login_id: "obsolete-origin",
    verification_uri: "https://example.test/device",
    user_code: "ABCD",
    expires_in_secs: 600,
  });
  const poll = vi.spyOn(api, "pollManagedLogin").mockReturnValue(pending.promise);
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const hook = renderHook(() => useDeviceLogin(), { wrapper: wrapper(client) });
  await act(async () => hook.result.current.start("codex"));
  await waitFor(() => expect(poll).toHaveBeenCalledTimes(1));
  hook.unmount();
  client.clear();
  await act(async () => {
    pending.resolve({ state: "complete", auth: { provider: "codex", signed_in: true } } as Awaited<
      ReturnType<typeof api.pollManagedLogin>
    >);
    await pending.promise;
  });
  expect(invalidate).not.toHaveBeenCalled();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});
