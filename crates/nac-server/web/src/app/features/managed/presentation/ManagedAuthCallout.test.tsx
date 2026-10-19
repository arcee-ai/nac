/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ManagedAuthCallout } from "@/app/features/managed/presentation/ManagedAuthCallout";
import type { DeviceLoginState } from "@/app/features/managed/controller/useDeviceLogin";

const fakes = vi.hoisted(() => ({
  signedIn: true,
  state: { status: "idle" } as DeviceLoginState,
  calls: [] as string[],
}));

vi.mock("@/app/features/managed/controller/useManagedSignIn", () => ({
  useManagedSignIn: () => ({ provider: "codex", signedIn: fakes.signedIn }),
}));
vi.mock("@/app/features/managed/controller/useDeviceLogin", () => ({
  useDeviceLogin: () => ({
    state: fakes.state,
    start: (provider: string) => {
      fakes.calls.push(`start:${provider}`);
      return Promise.resolve();
    },
    cancel: vi.fn(),
  }),
}));
vi.mock("@/app/services/queries", () => ({
  useManagedLogout: () => ({
    isPending: false,
    mutateAsync: (provider: string) => {
      fakes.calls.push(`logout:${provider}`);
      return Promise.resolve();
    },
  }),
  // A model index cached from before the login was refused still reads healthy.
  useManagedProviderModels: () => ({ isError: false, error: null }),
}));

beforeEach(() => {
  fakes.signedIn = true;
  fakes.state = { status: "idle" };
  fakes.calls = [];
});
afterEach(cleanup);

it("reports a healthy login as signed in", () => {
  render(<ManagedAuthCallout backend="chatgpt-codex-responses" />);

  expect(screen.getByText("Signed in")).toBeTruthy();
  expect(screen.queryByText("Sign in with ChatGPT")).toBeNull();
});

it("signs a refused credential out before signing in again", async () => {
  render(<ManagedAuthCallout backend="chatgpt-codex-responses" rejected />);

  expect(screen.queryByText("Signed in")).toBeNull();
  fireEvent.click(screen.getByText("Sign in to ChatGPT again"));

  await waitFor(() => expect(fakes.calls).toEqual(["logout:codex", "start:codex"]));
});

it("signs in directly when no credential is on file", async () => {
  fakes.signedIn = false;
  render(<ManagedAuthCallout backend="chatgpt-codex-responses" rejected />);

  fireEvent.click(screen.getByText("Sign in with ChatGPT"));

  await waitFor(() => expect(fakes.calls).toEqual(["start:codex"]));
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
