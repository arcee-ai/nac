/** @vitest-environment jsdom */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useErrorNotice } from "./useErrorNotice";

const handlers = vi.hoisted(() => ({ start: vi.fn(), settings: vi.fn() }));
vi.mock("@/app/features/managed/controller/useDeviceLogin", () => ({
  useDeviceLogin: () => ({ start: handlers.start }),
}));
vi.mock("@/app/providers/SessionActionsProvider", () => ({
  useSessionActions: () => ({ settings: handlers.settings }),
}));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("keeps a platform fix as an href without carrying request query credentials", () => {
  const { result } = renderHook(() => useErrorNotice("session", "arcee-auth"));
  const notice = result.current(
    "HTTP 402 from https://api2.apps.dev.arcee.ai/api/v1?access_token=private-canary: insufficient_credits",
  );
  expect(notice.action).toEqual({
    label: "Open wallet",
    href: "https://platform2.apps.dev.arcee.ai/api/wallet",
  });
  expect(JSON.stringify(notice)).not.toContain("private-canary");
  expect(handlers.start).not.toHaveBeenCalled();
  expect(handlers.settings).not.toHaveBeenCalled();
});

it("preserves login, settings and caller-supplied retry callbacks", () => {
  const retry = vi.fn();
  const { result } = renderHook(() => useErrorNotice("session", "arcee-auth"));
  for (const error of [
    "Arcee auth is not configured",
    "invalid model configuration: missing key",
    "HTTP 429: rate limit reached",
  ]) {
    const action = result.current(error, retry).action;
    if (!action || !("onClick" in action)) throw new Error("Expected the existing command action");
    action.onClick();
  }
  expect(handlers.start).toHaveBeenCalledExactlyOnceWith("arcee");
  expect(handlers.settings).toHaveBeenCalledExactlyOnceWith("session");
  expect(retry).toHaveBeenCalledOnce();
});

it("drops unavailable settings and retry actions", () => {
  const { result } = renderHook(() => useErrorNotice(null, "arcee-auth"));
  expect(result.current("invalid model configuration: missing key").action).toBeUndefined();
  expect(result.current("HTTP 429: rate limit reached").action).toBeUndefined();
});
