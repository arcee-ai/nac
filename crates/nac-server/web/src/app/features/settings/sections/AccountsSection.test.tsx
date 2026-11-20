/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { api } from "@/app/services/api";
import type { ModelCatalog } from "@/app/types/api";

import { AccountsSection } from "./AccountsSection";

vi.mock("@/app/features/managed/presentation/ManagedAuthCallout", () => ({
  ManagedAuthCallout: () => null,
}));

const name = "OPENAI_API_KEY";
const base = "https://api.openai.com/v1";

function catalog(ready: boolean): ModelCatalog {
  return {
    catalog_version: 1,
    providers: (["openai-responses", "openai-chat-completions"] as const).map((id) => ({
      id,
      auth: "api_key_env",
      auth_status: ready ? "ready" : "no_credential",
      auth_hint: ready ? null : name,
      connection: ready ? { api_key_env: name, base_url: base } : null,
      managed_base_url: null,
      default_base_url: base,
      default_limits: {
        context_window: 100_000,
        max_tokens: 1_000,
        supported_efforts: [],
      },
      models: [],
    })),
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AccountsSection />
    </QueryClientProvider>,
  );
}

async function enterKey(value: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Add OpenAI key" }));
  fireEvent.change(screen.getByLabelText("OpenAI API key"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("stores one OpenAI key through the API, shows persisted metadata on reopen, and removes it", async () => {
  const secret = "fixture-openai-key-739";
  let connected = false;
  vi.spyOn(api, "getModelCatalog").mockImplementation(async () => catalog(connected));
  vi.spyOn(api, "listCredentials").mockImplementation(async () => ({
    credentials: connected ? [{ name, last_four: "-739" }] : [],
  }));
  const store = vi.spyOn(api, "storeCredential").mockImplementation(async () => {
    connected = true;
  });
  const remove = vi.spyOn(api, "deleteCredential").mockImplementation(async () => {
    connected = false;
  });
  mount();
  await enterKey(secret);
  expect(await screen.findByText("Key ending in -739")).toBeTruthy();
  expect(store).toHaveBeenCalledExactlyOnceWith(name, secret);
  expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
  expect(screen.queryByText(secret)).toBeNull();

  cleanup();
  mount();
  expect(await screen.findByText("Key ending in -739")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove OpenAI key" }));
  expect(await screen.findByRole("button", { name: "Add OpenAI key" })).toBeTruthy();
  expect(remove).toHaveBeenCalledExactlyOnceWith(name);
});

it("keeps a failed write in edit mode without displaying the server error or a saved state", async () => {
  const secret = "fixture-failed-key";
  vi.spyOn(api, "getModelCatalog").mockResolvedValue(catalog(false));
  vi.spyOn(api, "listCredentials").mockResolvedValue({ credentials: [] });
  vi.spyOn(api, "storeCredential").mockRejectedValue(new Error(secret));
  mount();
  await enterKey(secret);
  const error = await screen.findByRole("alert");
  expect(error.textContent).toBe("Could not save the key. Try again.");
  expect(screen.queryByRole("button", { name: "Replace OpenAI key" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
});
