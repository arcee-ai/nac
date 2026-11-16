/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManagedSecretsPanel } from "@/app/features/managed/presentation/ManagedSecretsPanel";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import type { ManagedSecretSummary } from "@/app/types/api";

// Disposable synthetic values only; no credentials are loaded by these tests.
const originalName = "SYNTHETIC_SERVICE_TOKEN";
const originalValue = "synthetic-fixture-value-a";
const newerName = "SYNTHETIC_NEW_TOKEN";
const newerValue = "synthetic-fixture-value-b";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let client: QueryClient;

function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ManagedSecretsPanel />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return {
    name: screen.getByLabelText<HTMLInputElement>("Variable name"),
    value: screen.getByLabelText<HTMLInputElement>("New value"),
    save: screen.getByRole<HTMLButtonElement>("button", { name: "Save secret" }),
  };
}

function fillDraft(name: string, value: string) {
  fireEvent.change(screen.getByLabelText("Variable name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("New value"), { target: { value } });
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.spyOn(api, "listManagedSecrets").mockResolvedValue({ healthy: true, secrets: [] });
});

afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ManagedSecretsPanel draft ownership", () => {
  it.each(["name", "value", "both", "edit-and-revert"])(
    "retains a newer %s draft when the original save succeeds",
    async (edit) => {
      const pending = deferred<ManagedSecretSummary>();
      const put = vi.spyOn(api, "putManagedSecret").mockReturnValue(pending.promise);
      const view = mount();
      fillDraft(originalName, originalValue);
      expect(view.value.type).toBe("password");
      expect(put).not.toHaveBeenCalled();
      fireEvent.click(view.save);
      await waitFor(() => {
        expect(put).toHaveBeenCalledExactlyOnceWith(originalName, originalValue);
        expect(view.save.disabled).toBe(true);
      });

      const expectedName = edit === "value" ? originalName : newerName;
      const expectedValue = edit === "name" ? originalValue : newerValue;
      fillDraft(expectedName, expectedValue);
      if (edit === "edit-and-revert") fillDraft(originalName, originalValue);
      fireEvent.click(view.save);
      expect(put).toHaveBeenCalledTimes(1);

      await act(async () => {
        pending.resolve({ name: originalName, updated_at_unix_ms: 1 });
        await pending.promise;
      });
      await screen.findByText("Secret saved for future command spawns");
      expect(view.name.value).toBe(edit === "edit-and-revert" ? originalName : expectedName);
      expect(view.value.value).toBe(edit === "edit-and-revert" ? originalValue : expectedValue);
      expect(put).toHaveBeenCalledExactlyOnceWith(originalName, originalValue);
      expect(screen.queryByText(originalValue)).toBeNull();
      expect(screen.queryByText(newerValue)).toBeNull();
    },
  );

  it("clears an unchanged draft after exactly one successful save", async () => {
    const pending = deferred<ManagedSecretSummary>();
    const put = vi.spyOn(api, "putManagedSecret").mockReturnValue(pending.promise);
    const view = mount();
    fillDraft(originalName, originalValue);
    fireEvent.click(view.save);
    await waitFor(() => expect(put).toHaveBeenCalledOnce());
    await act(async () => {
      pending.resolve({ name: originalName, updated_at_unix_ms: 1 });
      await pending.promise;
    });
    await screen.findByText("Secret saved for future command spawns");
    expect(view.name.value).toBe("");
    expect(view.value.value).toBe("");
    expect(put).toHaveBeenCalledExactlyOnceWith(originalName, originalValue);
  });

  it.each([false, true])("preserves the draft on rejection, newer edit=%s", async (edit) => {
    const pending = deferred<ManagedSecretSummary>();
    const put = vi.spyOn(api, "putManagedSecret").mockReturnValue(pending.promise);
    const view = mount();
    fillDraft(originalName, originalValue);
    fireEvent.click(view.save);
    await waitFor(() => expect(put).toHaveBeenCalledOnce());
    if (edit) fillDraft(newerName, newerValue);
    await act(async () => {
      pending.reject(new Error("synthetic fixture rejection"));
      await pending.promise.catch(() => {});
    });
    await screen.findByText("Secret was not saved: synthetic fixture rejection");
    expect(view.name.value).toBe(edit ? newerName : originalName);
    expect(view.value.value).toBe(edit ? newerValue : originalValue);
    expect(view.value.type).toBe("password");
    expect(put).toHaveBeenCalledExactlyOnceWith(originalName, originalValue);
  });

  it("keeps invalid edits local and masked without a write", () => {
    const put = vi.spyOn(api, "putManagedSecret");
    const view = mount();
    fillDraft("INVALID NAME", originalValue);
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(view.save);
    expect(put).not.toHaveBeenCalled();
    expect(view.name.value).toBe("INVALID NAME");
    expect(view.value.value).toBe(originalValue);
    expect(view.value.type).toBe("password");
    expect(screen.queryByText(originalValue)).toBeNull();
  });
});
