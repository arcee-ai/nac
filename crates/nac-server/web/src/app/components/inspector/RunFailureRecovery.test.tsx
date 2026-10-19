/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { RunFailureRecovery } from "@/app/components/inspector/RunFailureRecovery";
import { api } from "@/app/services/api";
import { refreshProviderAuthentication } from "@/app/services/queries/configuration";
import type { ManagedAuthList, RunFailure, SessionGoalRecord } from "@/app/types/api";

const refused: RunFailure = {
  kind: "authentication",
  phase: "request",
  transient: false,
  attempt_count: 1,
  summary: "The Arcee sign-in expired or was revoked. Sign in again to continue.",
  diagnostic: "Arcee authorization was revoked or expired.",
  recovery_action: "settings",
};

// What the server reports: which credential is on file, and whether it works.
const server = { credential: null as { expires: number } | null, works: false, latency: 0 };

function later<T>(answer: () => T): Promise<Awaited<T>> {
  return new Promise((resolve, reject) =>
    setTimeout(() => Promise.resolve(answer()).then(resolve, reject), server.latency),
  );
}

function authList(): ManagedAuthList {
  return {
    providers: [
      {
        provider: "arcee",
        backend: "arcee-auth",
        signed_in: server.credential !== null,
        expires_at_ms: server.credential?.expires ?? null,
        account: null,
        organization: null,
        base_url: null,
        path: "arcee_auth.json",
      },
    ],
  };
}

beforeEach(() => {
  server.credential = null;
  server.works = false;
  server.latency = 0;
  vi.spyOn(api, "listManagedAuth").mockImplementation(() => later(authList));
  vi.spyOn(api, "listProviderModels").mockImplementation(() =>
    later(() =>
      server.works
        ? { base_url: "https://api.arcee.ai/api/v1", models: [] }
        : Promise.reject(new Error("HTTP 401 from https://api.arcee.ai/api/v1/models")),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderRecovery(
  client: QueryClient,
  goal: SessionGoalRecord | null = null,
  onRegenerate: () => void = () => {},
) {
  return render(
    <QueryClientProvider client={client}>
      <RunFailureRecovery
        failure={refused}
        goal={goal}
        backend="arcee-auth"
        onResumeGoal={() => {}}
        onOpenSettings={() => {}}
        onRegenerate={onRegenerate}
      />
    </QueryClientProvider>,
  );
}

function signInElsewhere() {
  server.credential = { expires: Date.now() + 3_600_000 };
  server.works = true;
}

it("offers the sign-in, then the retry once a login made elsewhere works", async () => {
  const client = newClient();
  renderRecovery(client);

  await screen.findByText("Sign in with Arcee");
  expect(screen.queryByText("Regenerate from original prompt")).toBeNull();

  // Settings, another tab or the CLI: the server's list is all that changes.
  signInElsewhere();
  await act(() => refreshProviderAuthentication(client));

  await screen.findByText("Regenerate from original prompt");
  expect(screen.queryByText("Sign in with Arcee")).toBeNull();
});

it("keeps the retry across remount and reload once the login works", async () => {
  signInElsewhere();
  const client = newClient();
  const first = renderRecovery(client);
  await screen.findByText("Regenerate from original prompt");

  first.unmount();
  renderRecovery(client);
  await screen.findByText("Regenerate from original prompt");

  cleanup();
  renderRecovery(newClient());
  await screen.findByText("Regenerate from original prompt");
});

it("asks for a sign-in again while the refused credential is still on file", async () => {
  server.credential = { expires: Date.now() + 3_600_000 };
  renderRecovery(newClient());

  await screen.findByText("Sign in to Arcee again");
  expect(screen.queryByText("Regenerate from original prompt")).toBeNull();
});

it("resumes a blocked goal once the login works", async () => {
  signInElsewhere();
  renderRecovery(newClient(), { status: "blocked" } as SessionGoalRecord);

  await screen.findByText("Resume goal");
  await waitFor(() => expect(screen.queryByText("Regenerate from original prompt")).toBeNull());
});

it("signs the refused credential out, completes the device login and retries", async () => {
  // A real server answers after the sign-out's re-check has rendered.
  server.latency = 30;
  server.credential = { expires: Date.now() + 3_600_000 };
  vi.spyOn(window, "open").mockReturnValue(null);
  const logout = vi.spyOn(api, "managedLogout").mockImplementation(() => {
    server.credential = null;
    return later(() => authList().providers[0]);
  });
  const start = vi.spyOn(api, "startManagedLogin").mockResolvedValue({
    login_id: "login-1",
    provider: "arcee",
    user_code: "ABCD-1234",
    verification_uri: "https://platform.arcee.ai/device?code=ABCD-1234",
    expires_in_secs: 600,
  });
  vi.spyOn(api, "pollManagedLogin").mockImplementation(() => {
    signInElsewhere();
    return Promise.resolve({ state: "complete", auth: authList().providers[0] });
  });
  const onRegenerate = vi.fn();
  renderRecovery(newClient(), null, onRegenerate);

  fireEvent.click(await screen.findByText("Sign in to Arcee again"));
  fireEvent.click(await screen.findByText("Regenerate from original prompt"));

  expect(logout).toHaveBeenCalledWith("arcee");
  expect(start).toHaveBeenCalledWith("arcee");
  expect(onRegenerate).toHaveBeenCalledOnce();
});

it("notices a sign-in made at the CLI on its next poll", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    renderRecovery(newClient());
    await screen.findByText("Sign in with Arcee");

    signInElsewhere();
    await act(() => vi.advanceTimersByTimeAsync(10_000));

    await screen.findByText("Regenerate from original prompt");
  } finally {
    vi.useRealTimers();
  }
});
