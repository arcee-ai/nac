/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ManagedAuthCallout } from "@/app/features/managed/presentation/ManagedAuthCallout";
import type { DeviceLoginState } from "@/app/features/managed/controller/useDeviceLogin";

const fakes = vi.hoisted(() => ({
  provider: "codex" as "codex" | "arcee",
  signedIn: true,
  state: { status: "idle" } as DeviceLoginState,
  calls: [] as string[],
}));

vi.mock("@/app/features/managed/controller/useManagedSignIn", () => ({
  useManagedSignIn: () => ({ provider: fakes.provider, signedIn: fakes.signedIn }),
}));
vi.mock("@/app/features/managed/controller/useDeviceLogin", () => ({
  useDeviceLogin: () => ({
    state: fakes.state,
    start: (provider: string) => {
      fakes.calls.push(`start:${provider}`);
      return Promise.resolve();
    },
    cancel: () => fakes.calls.push("cancel"),
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
  fakes.provider = "codex";
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

it.each([
  { provider: "codex" as const, backend: "chatgpt-codex-responses" as const, label: "ChatGPT" },
  { provider: "arcee" as const, backend: "arcee-auth" as const, label: "Arcee" },
])(
  "keeps the same $provider attempt behind a real retry link and cancel",
  ({ provider, backend, label }) => {
    fakes.provider = provider;
    const verification = "https://accounts.example.test/device?code=local-fixture";
    fakes.state = {
      status: "waiting",
      prompt: { user_code: "ABCD-1234", verification_uri: verification },
    } as DeviceLoginState;
    render(<ManagedAuthCallout backend={backend} rejected />);

    expect(screen.getByText("ABCD-1234")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
    const link = screen.getByRole("link", { name: `Open ${label}` });
    expect(link.getAttribute("href")).toBe(verification);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")?.split(" ")).toEqual(
      expect.arrayContaining(["noopener", "noreferrer"]),
    );
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(fakes.calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fakes.calls).toEqual(["cancel"]);
  },
);
