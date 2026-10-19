/** @vitest-environment jsdom */

import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useAuthErrorSuppressed } from "@/app/hooks/useAuthErrorSuppressed";
import { useErrorNotice } from "@/app/hooks/useErrorNotice";

const fakes = vi.hoisted(() => ({
  signedIn: false,
  reachable: true,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/app/services/queries", () => ({
  queryKeys: { managedProviderModels: (backend: string) => ["managed-provider-models", backend] },
  useManagedAuth: (enabled: boolean) => ({
    data: enabled
      ? { providers: [{ provider: "arcee", backend: "arcee-auth", signed_in: fakes.signedIn }] }
      : undefined,
    isError: false,
  }),
  useManagedProviderModels: (_backend: string | null, enabled: boolean) => ({
    isError: enabled && !fakes.reachable,
  }),
}));
vi.mock("@/app/features/managed/controller/useDeviceLogin", () => ({
  useDeviceLogin: () => ({ start: vi.fn() }),
}));
vi.mock("@/app/providers/SessionActionsProvider", () => ({
  useSessionActions: () => ({ settings: vi.fn() }),
}));

const LOGGED_OUT_402 =
  'HTTP 402 from https://api.arcee.ai/api/v1/chat/completions: {"error":{"message":"Insufficient credits","code":"billing.insufficient_credits"}}';

beforeEach(() => {
  fakes.signedIn = false;
  fakes.reachable = true;
});

it("offers a sign-in for a billing-shaped failure while signed out", () => {
  const { result } = renderHook(() => useErrorNotice("session-1", "arcee-auth"));

  const notice = result.current(LOGGED_OUT_402);

  expect(notice.title).toBe("Not signed in to Arcee");
  expect(notice.action?.label).toBe("Sign in");
});

it("takes down a signed-out billing notice once the login works again", () => {
  const { result, rerender } = renderHook(
    ({ error }: { error: string | null }) => useAuthErrorSuppressed("arcee-auth", error),
    { initialProps: { error: LOGGED_OUT_402 } },
  );
  expect(result.current).toBe(false);

  fakes.signedIn = true;
  rerender({ error: LOGGED_OUT_402 });

  expect(result.current).toBe(true);
});

it("keeps a credit failure raised while signed in on screen", () => {
  fakes.signedIn = true;
  const { result, rerender } = renderHook(
    ({ error }: { error: string | null }) => useAuthErrorSuppressed("arcee-auth", error),
    { initialProps: { error: LOGGED_OUT_402 as string | null } },
  );
  expect(result.current).toBe(false);

  // A new run clears the failure, so an identical one later is judged afresh.
  fakes.signedIn = false;
  rerender({ error: LOGGED_OUT_402 });
  rerender({ error: null });
  fakes.signedIn = true;
  rerender({ error: LOGGED_OUT_402 });

  expect(result.current).toBe(false);
});
