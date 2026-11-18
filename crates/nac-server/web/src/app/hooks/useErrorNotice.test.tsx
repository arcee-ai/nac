/** @vitest-environment jsdom */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useErrorNotice } from "./useErrorNotice";

const handlers = vi.hoisted(() => ({ start: vi.fn(), navigate: vi.fn() }));
vi.mock("@/app/features/managed/controller/useDeviceLogin", () => ({
  useDeviceLogin: () => ({ start: handlers.start }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => handlers.navigate }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function click(action: ReturnType<ReturnType<typeof useErrorNotice>>["action"]) {
  if (!action || !("onClick" in action)) throw new Error("Expected a command action");
  action.onClick();
}

it("keeps a platform fix as an href without carrying request query credentials", () => {
  const { result } = renderHook(() => useErrorNotice("arcee-auth"));
  const notice = result.current(
    "HTTP 402 from https://api2.apps.dev.arcee.ai/api/v1?access_token=private-canary: insufficient_credits",
  );
  expect(notice.action).toEqual({
    label: "Open wallet",
    href: "https://platform2.apps.dev.arcee.ai/api/wallet",
  });
  expect(JSON.stringify(notice)).not.toContain("private-canary");
  expect(handlers.start).not.toHaveBeenCalled();
  expect(handlers.navigate).not.toHaveBeenCalled();
});

it("preserves login and caller-supplied retry callbacks", () => {
  const retry = vi.fn();
  const { result } = renderHook(() => useErrorNotice("arcee-auth"));
  for (const error of ["Arcee auth is not configured", "HTTP 429: rate limit reached"]) {
    click(result.current(error, retry).action);
  }
  expect(handlers.start).toHaveBeenCalledExactlyOnceWith("arcee");
  expect(retry).toHaveBeenCalledOnce();
});

it("leaves a broken model configuration to its wording", () => {
  const { result } = renderHook(() => useErrorNotice("arcee-auth"));
  expect(result.current("invalid model configuration: missing key").action).toBeUndefined();
});

it("sends a rejected key to the accounts page", () => {
  const { result } = renderHook(() => useErrorNotice("arcee-api"));
  const notice = result.current("HTTP 401: invalid api key");
  expect(notice.action).toMatchObject({ label: "Open accounts" });
  click(notice.action);
  expect(handlers.navigate).toHaveBeenCalledExactlyOnceWith("/settings/accounts");
});

it("drops an unavailable retry action", () => {
  const { result } = renderHook(() => useErrorNotice("arcee-auth"));
  expect(result.current("HTTP 429: rate limit reached").action).toBeUndefined();
});
