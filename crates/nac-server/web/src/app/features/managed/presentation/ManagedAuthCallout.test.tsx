/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ManagedAuthCallout } from "@/app/features/managed/presentation/ManagedAuthCallout";
import type { DeviceLoginState } from "@/app/features/managed/controller/useDeviceLogin";

const fakes = vi.hoisted(() => ({
  signedIn: true,
  state: { status: "idle" } as DeviceLoginState,
  onSuccess: undefined as (() => void) | undefined,
}));

vi.mock("@/app/features/managed/controller/useManagedSignIn", () => ({
  useManagedSignIn: () => ({ provider: "codex", signedIn: fakes.signedIn }),
}));
vi.mock("@/app/features/managed/controller/useDeviceLogin", () => ({
  useDeviceLogin: (onSuccess?: () => void) => {
    fakes.onSuccess = onSuccess;
    return { state: fakes.state, start: vi.fn(), cancel: vi.fn() };
  },
}));
vi.mock("@/app/services/queries", () => ({
  useManagedLogout: () => ({ isPending: false, mutateAsync: vi.fn() }),
  // A model index cached from before the login was refused still reads healthy.
  useManagedProviderModels: () => ({ isError: false, error: null }),
}));

beforeEach(() => {
  fakes.signedIn = true;
  fakes.state = { status: "idle" };
  fakes.onSuccess = undefined;
});
afterEach(cleanup);

it("reports a healthy login as signed in", () => {
  render(<ManagedAuthCallout backend="chatgpt-codex-responses" />);

  expect(screen.getByText("Signed in")).toBeTruthy();
  expect(screen.queryByText("Sign in with ChatGPT")).toBeNull();
});

it("offers a sign-in for a rejected login even while a credential is on file", () => {
  render(<ManagedAuthCallout backend="chatgpt-codex-responses" rejected />);

  expect(screen.getByText("Sign in with ChatGPT")).toBeTruthy();
  expect(screen.queryByText("Signed in")).toBeNull();
});

it("shows the device code, the verification page and cancel while the sign-in waits", () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  fakes.state = {
    status: "waiting",
    prompt: { user_code: "ABCD-1234", verification_uri: "https://auth.openai.com/codex/device" },
  } as DeviceLoginState;
  render(<ManagedAuthCallout backend="chatgpt-codex-responses" rejected />);

  expect(screen.getByText("ABCD-1234")).toBeTruthy();
  expect(screen.getByText("Cancel")).toBeTruthy();
  fireEvent.click(screen.getByText("Open ChatGPT"));
  expect(open).toHaveBeenCalledWith(
    "https://auth.openai.com/codex/device",
    "_blank",
    "noopener,noreferrer",
  );
  open.mockRestore();
});

it("reports a completed sign-in to its caller", () => {
  const onSignedIn = vi.fn();
  render(<ManagedAuthCallout backend="chatgpt-codex-responses" rejected onSignedIn={onSignedIn} />);

  fakes.onSuccess?.();

  expect(onSignedIn).toHaveBeenCalledOnce();
});
