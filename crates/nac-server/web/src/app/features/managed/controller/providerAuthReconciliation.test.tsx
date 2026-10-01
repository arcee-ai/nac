/** @vitest-environment jsdom */

import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { isolatedRegistry, readAsync } from "@/app/effect/remote";
import { useDeviceLogin } from "@/app/features/managed/controller/useDeviceLogin";
import { api, apiEffect } from "@/app/services/api";
import { managedLogoutAtom } from "@/app/services/queries/host";
import { modelCatalogAtom } from "@/app/services/queries/configuration";
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

function wrapper(registry: ReturnType<typeof isolatedRegistry>) {
  return ({ children }: PropsWithChildren) => (
    <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
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
  const getCatalog = vi.fn();
  getCatalog.mockResolvedValueOnce(catalog(false)).mockResolvedValue(catalog(true));
  vi.spyOn(apiEffect, "getModelCatalog").mockImplementation(() =>
    Effect.promise(() => getCatalog()),
  );
  vi.spyOn(apiEffect, "listManagedAuth").mockImplementation(() =>
    Effect.promise(() => Promise.resolve({ providers: [] })),
  );
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
  const registry = isolatedRegistry();
  const hook = renderHook(
    () => ({
      catalog: readAsync(useAtomValue(modelCatalogAtom())),
      login: useDeviceLogin(),
    }),
    { wrapper: wrapper(registry) },
  );

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
  }
});

it("refetches the unified catalog when logout removes readiness", async () => {
  const getCatalog = vi.fn();
  getCatalog.mockResolvedValueOnce(catalog(true)).mockResolvedValue(catalog(false));
  vi.spyOn(apiEffect, "getModelCatalog").mockImplementation(() =>
    Effect.promise(() => getCatalog()),
  );
  vi.spyOn(apiEffect, "managedLogout").mockImplementation(() =>
    Effect.promise(() =>
      Promise.resolve({
        provider: "codex",
        backend: "chatgpt-codex-responses",
        base_url: null,
        signed_in: false,
        account: null,
        organization: null,
        expires_at_ms: null,
        path: "/server-owned/auth.json",
      }),
    ),
  );
  vi.spyOn(apiEffect, "listManagedAuth").mockImplementation(() =>
    Effect.promise(() => Promise.resolve({ providers: [] })),
  );
  const registry = isolatedRegistry();
  const hook = renderHook(
    () => ({
      catalog: readAsync(useAtomValue(modelCatalogAtom())),
      logout: useAtomSet(managedLogoutAtom, { mode: "promise" }),
    }),
    { wrapper: wrapper(registry) },
  );

  try {
    await waitFor(() => expect(hook.result.current.catalog.data).toEqual(catalog(true)));
    await act(async () => {
      await hook.result.current.logout("codex");
    });
    await waitFor(() => {
      const cached = registry.get(modelCatalogAtom());
      expect(AsyncResult.isSuccess(cached) ? cached.value : undefined).toEqual(catalog(false));
      expect(getCatalog).toHaveBeenCalledTimes(2);
    });
  } finally {
    hook.unmount();
  }
});
