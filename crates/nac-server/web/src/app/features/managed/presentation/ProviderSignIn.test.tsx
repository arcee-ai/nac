/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ManagedAuthCallout } from "@/app/features/managed/presentation/ManagedAuthCallout";
import { ProviderConnections } from "@/app/features/managed/presentation/ProviderConnections";
import { api } from "@/app/services/api";
import type { ManagedAuthList, ManagedAuthProvider, ManagedAuthStatus } from "@/app/types/api";

// Every value below is a fixture; none of it is a real account or device code.
const CODE = "FAKE-0550";

function account(provider: ManagedAuthProvider, signedIn: boolean): ManagedAuthStatus {
  return {
    provider,
    backend: provider === "arcee" ? "arcee-auth" : "chatgpt-codex-responses",
    base_url: null,
    signed_in: signedIn,
    account: signedIn ? `${provider}@example.test` : null,
    organization: null,
    expires_at_ms: null,
    path: `/server-owned/${provider}.json`,
  };
}

function accounts(codex: boolean, arcee = false): ManagedAuthList {
  return { providers: [account("arcee", arcee), account("codex", codex)] };
}

function prompt(provider: ManagedAuthProvider, loginId = `${provider}-login`) {
  return {
    provider,
    login_id: loginId,
    verification_uri: "https://example.test/device",
    user_code: provider === "codex" ? CODE : "FAKE-ARCEE",
    expires_in_secs: 600,
  };
}

let client: QueryClient;

function mount(node: ReactNode) {
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(node, { wrapper });
}

const codexCallout = () => <ManagedAuthCallout backend="chatgpt-codex-responses" />;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("open", vi.fn());
  vi.spyOn(api, "getModelCatalog").mockResolvedValue({
    catalog_version: 1,
    providers: [],
  });
  vi.spyOn(api, "getManagedStatus").mockRejectedValue(new Error("not managed"));
  vi.spyOn(api, "listProviderModels").mockResolvedValue({
    base_url: "https://example.test",
    models: [],
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("says it is checking until the login list answers, and offers sign-in only once signed out is known", async () => {
  const answer = Promise.withResolvers<ManagedAuthList>();
  vi.spyOn(api, "listManagedAuth").mockReturnValue(answer.promise);
  mount(codexCallout());

  expect(screen.getByRole("status").textContent).toContain("Checking connection…");
  expect(screen.queryByRole("button", { name: /Sign in/ })).toBeNull();

  await act(async () => answer.resolve(accounts(false)));

  expect(await screen.findByRole("button", { name: "Sign in with ChatGPT" })).toBeTruthy();
  expect(screen.queryByText("Checking connection…")).toBeNull();
});

it("reports a failed check with a retry instead of a sign-in, then settles on the retried answer", async () => {
  const list = vi
    .spyOn(api, "listManagedAuth")
    .mockRejectedValueOnce(new Error("HTTP 503 from /auth"))
    .mockResolvedValue(accounts(true));
  mount(codexCallout());

  expect((await screen.findByRole("alert")).textContent).toContain(
    "NAC could not check the ChatGPT login",
  );
  expect(screen.queryByRole("button", { name: /Sign in/ })).toBeNull();
  expect(screen.queryByText("Signed in")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));

  expect(await screen.findByText("Signed in")).toBeTruthy();
  expect(list).toHaveBeenCalledTimes(2);
});

it("keeps a valid login signed in when its model list times out, and never signs it out", async () => {
  vi.spyOn(api, "listManagedAuth").mockResolvedValue(accounts(true));
  const models = vi
    .spyOn(api, "listProviderModels")
    .mockRejectedValueOnce(new Error("request timed out"))
    .mockResolvedValue({ base_url: "https://example.test", models: [] });
  const logout = vi.spyOn(api, "managedLogout");
  mount(codexCallout());

  expect(await screen.findByText(/model list did not load/)).toBeTruthy();
  expect(screen.getByText("Signed in")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Sign in/ })).toBeNull();
  expect(logout).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Reload models" }));
  await waitFor(() => expect(screen.queryByText(/model list did not load/)).toBeNull());
  expect(models).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Signed in")).toBeTruthy();
  expect(logout).not.toHaveBeenCalled();
});

it("treats an explicit provider refusal as a login to replace, and replaces it only when asked", async () => {
  vi.spyOn(api, "listManagedAuth").mockResolvedValue(accounts(true));
  vi.spyOn(api, "listProviderModels").mockRejectedValue(
    new Error("HTTP 401 from https://example.test/models: unauthorized"),
  );
  const calls: string[] = [];
  vi.spyOn(api, "managedLogout").mockImplementation(async (provider) => {
    calls.push(`logout:${provider}`);
    return account(provider, false);
  });
  vi.spyOn(api, "startManagedLogin").mockImplementation(async (provider) => {
    calls.push(`start:${provider}`);
    return prompt(provider);
  });
  vi.spyOn(api, "pollManagedLogin").mockResolvedValue({ state: "pending" });
  mount(codexCallout());

  const again = await screen.findByRole("button", {
    name: "Sign in to ChatGPT again",
  });
  expect(screen.queryByText("Signed in")).toBeNull();
  expect(calls).toEqual([]);

  fireEvent.click(again);

  await waitFor(() => expect(calls).toEqual(["logout:codex", "start:codex"]));
});

it("keeps two provider accounts independent while one of them signs in", async () => {
  vi.spyOn(api, "listManagedAuth").mockResolvedValue(accounts(false, true));
  const start = vi.spyOn(api, "startManagedLogin").mockResolvedValue(prompt("codex"));
  vi.spyOn(api, "pollManagedLogin").mockResolvedValue({ state: "pending" });
  const logout = vi.spyOn(api, "managedLogout");
  mount(<ProviderConnections />);

  const [arcee, codex] = await waitFor(() => {
    const cards = screen
      .getByRole("region", { name: "Provider connections" })
      .querySelectorAll<HTMLElement>(":scope > div");
    expect(cards).toHaveLength(2);
    return [...cards];
  });
  expect(await within(arcee!).findByText("Signed in")).toBeTruthy();
  fireEvent.click(await within(codex!).findByRole("button", { name: "Sign in with ChatGPT" }));

  expect(await within(codex!).findByText(CODE)).toBeTruthy();
  expect(within(arcee!).getByText("Signed in")).toBeTruthy();
  expect(start).toHaveBeenCalledExactlyOnceWith("codex");
  expect(logout).not.toHaveBeenCalled();
});

it("resumes a pending sign-in when reopened and returns to sign-in after Cancel", async () => {
  vi.spyOn(api, "listManagedAuth").mockResolvedValue(accounts(false));
  const start = vi.spyOn(api, "startManagedLogin").mockResolvedValue(prompt("codex"));
  vi.spyOn(api, "pollManagedLogin").mockResolvedValue({ state: "pending" });
  const cancel = vi.spyOn(api, "cancelManagedLogin").mockResolvedValue(undefined);
  const first = mount(codexCallout());
  fireEvent.click(await screen.findByRole("button", { name: "Sign in with ChatGPT" }));
  expect(await screen.findByText(CODE)).toBeTruthy();
  first.unmount();

  mount(codexCallout());
  expect(await screen.findByText(CODE)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(await screen.findByRole("button", { name: "Sign in with ChatGPT" })).toBeTruthy();
  expect(cancel).toHaveBeenCalledExactlyOnceWith("codex", "codex-login");
  cleanup();
  mount(codexCallout());
  expect(await screen.findByRole("button", { name: "Sign in with ChatGPT" })).toBeTruthy();
  expect(screen.queryByText(CODE)).toBeNull();
  expect(start).toHaveBeenCalledTimes(1);
});

it("settles a sign-in that completes while its view is closed and shows it signed in on reopening", async () => {
  let signedIn = false;
  vi.spyOn(api, "listManagedAuth").mockImplementation(async () => accounts(signedIn));
  vi.spyOn(api, "startManagedLogin").mockResolvedValue(prompt("codex"));
  const approval = Promise.withResolvers<Awaited<ReturnType<typeof api.pollManagedLogin>>>();
  const poll = vi.spyOn(api, "pollManagedLogin").mockReturnValue(approval.promise);
  const cancel = vi.spyOn(api, "cancelManagedLogin");
  const view = mount(codexCallout());
  fireEvent.click(await screen.findByRole("button", { name: "Sign in with ChatGPT" }));
  expect(await screen.findByText(CODE)).toBeTruthy();
  await waitFor(() => expect(poll).toHaveBeenCalled());
  view.unmount();

  signedIn = true;
  await act(async () => approval.resolve({ state: "complete", auth: account("codex", true) }));

  mount(codexCallout());
  expect(await screen.findByText("Signed in")).toBeTruthy();
  expect(screen.queryByText(CODE)).toBeNull();
  expect(cancel).not.toHaveBeenCalled();
});

function grantClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

async function waitingForCode() {
  vi.spyOn(api, "listManagedAuth").mockResolvedValue(accounts(false));
  vi.spyOn(api, "startManagedLogin").mockResolvedValue(prompt("codex"));
  vi.spyOn(api, "pollManagedLogin").mockResolvedValue({ state: "pending" });
  mount(codexCallout());
  fireEvent.click(await screen.findByRole("button", { name: "Sign in with ChatGPT" }));
  return screen.findByRole("button", { name: "Copy code" });
}

it("copies exactly the visible device code and announces the copy", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  grantClipboard(writeText);
  const copy = await waitingForCode();
  expect(screen.getByRole("button", { name: /Open ChatGPT/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();

  copy.focus();
  fireEvent.click(copy);

  const status = await screen.findByText("Code copied");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(writeText).toHaveBeenCalledExactlyOnceWith(
    screen.getByTestId("provider-device-code").textContent,
  );
  expect(writeText).toHaveBeenCalledWith(CODE);
  expect(document.activeElement).toBe(copy);
});

it("says the copy failed when the clipboard is denied, without claiming success", async () => {
  const writeText = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  grantClipboard(writeText);
  const copy = await waitingForCode();

  copy.focus();
  fireEvent.click(copy);

  const status = await screen.findByText(/Couldn't copy the code/);
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(screen.queryByText("Code copied")).toBeNull();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(CODE);
  expect(document.activeElement).toBe(copy);
  expect(screen.getByTestId("provider-device-code").textContent).toBe(CODE);
});
