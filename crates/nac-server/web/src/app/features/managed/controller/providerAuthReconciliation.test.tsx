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
  expect(signal?.aborted).toBe(true);
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
