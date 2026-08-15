/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatInputBox } from "@/app/components/inspector/ChatInputBox";
import { SessionActionsProvider } from "@/app/providers/SessionActionsProvider";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import type { SlashCommandDefinition } from "@/app/types/api";

// The component runs against the real providers, stores, and api object; the
// network is replaced by spies on the api methods, delegating to these
// per-test fakes. jsdom lacks matchMedia, so a desktop stub stands in.
const fakes = {
  listCommands: vi.fn(),
  submitRun: vi.fn(),
  compactSession: vi.fn(),
  getModelCatalog: vi.fn(),
  getStore: vi.fn(),
};

vi.spyOn(api, "listCommands").mockImplementation((...args) =>
  fakes.listCommands(...args),
);
vi.spyOn(api, "submitRun").mockImplementation((...args) =>
  fakes.submitRun(...args),
);
vi.spyOn(api, "compactSession").mockImplementation((...args) =>
  fakes.compactSession(...args),
);
vi.spyOn(api, "getModelCatalog").mockImplementation((...args) =>
  fakes.getModelCatalog(...args),
);
vi.spyOn(api, "getStore").mockImplementation((...args) =>
  fakes.getStore(...args),
);

const compactDefinition: SlashCommandDefinition = {
  command: "compact",
  name: "compact",
  description: "Compact the current session context",
  accepts_arguments: false,
};

/** The slash-command list the next composed editor starts with, if loaded. */
let commandFixtures: SlashCommandDefinition[] | undefined;

function composer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (commandFixtures !== undefined) {
    client.setQueryData(queryKeys.slashCommands, commandFixtures);
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <SessionActionsProvider>
            <ChatInputBox sessionId="session" snapshot={null} entry={null} />
          </SessionActionsProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const textarea = screen.getByRole("combobox", { name: "Message" });
  textarea.focus();
  // SAFETY: the composer renders a single textarea as its combobox input.
  return textarea as HTMLTextAreaElement;
}

function type(textarea: HTMLTextAreaElement, value: string) {
  fireEvent.change(textarea, { target: { value } });
}

beforeEach(() => {
  commandFixtures = [compactDefinition];
  // Queries that stay pending keep their loading state, matching the previous
  // module mocks' `data: undefined`.
  fakes.listCommands.mockReset().mockImplementation(
    () => new Promise(() => {}),
  );
  fakes.submitRun.mockReset().mockResolvedValue({
    run_id: "run",
    client_id: null,
    display_prompt: "prompt",
  });
  fakes.compactSession.mockReset().mockResolvedValue({
    status: "compacted",
    compaction_id: "compaction",
  });
  fakes.getModelCatalog.mockReset().mockImplementation(
    () => new Promise(() => {}),
  );
  fakes.getStore.mockReset().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("slash-command suggestions", () => {
  it("opens from the initial token, filters case-insensitively, and exposes active-option semantics", () => {
    const textarea = composer();
    type(textarea, "  /C");

    const listbox = screen.getByRole("listbox", { name: "Slash commands" });
    const option = screen.getByRole("option", { name: /compact/i });
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    expect(textarea.getAttribute("aria-controls")).toBe(listbox.id);
    expect(textarea.getAttribute("aria-activedescendant")).toBe(option.id);
    expect(screen.getByRole("status").textContent).toContain(
      "1 slash command available",
    );

    type(textarea, "  /CO");
    expect(screen.getByRole("option", { name: /compact/i })).toBeTruthy();
  });

  it("does not open for ordinary prose or path-like text", () => {
    const textarea = composer();
    type(textarea, "Please mention /compact in the documentation");
    expect(screen.queryByRole("listbox")).toBeNull();

    type(textarea, "/tmp/session");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows no matches and waits for dismissal before unknown-command submission", async () => {
    const textarea = composer();
    fakes.submitRun.mockRejectedValueOnce(
      new Error("unknown slash command: /xyz"),
    );
    type(textarea, "/xyz");

    expect(screen.getByRole("listbox").textContent).toContain(
      "No matching commands",
    );
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(fakes.submitRun).not.toHaveBeenCalled();
    expect(textarea.value).toBe("/xyz");

    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() =>
      expect(fakes.submitRun).toHaveBeenCalledWith("session", "/xyz"),
    );
    expect(fakes.compactSession).not.toHaveBeenCalled();
    await waitFor(() =>
      // The composer reports through `humanErrorText`, which opens a backend
      // message as a sentence — the server sends this one lower-case.
      expect(
        screen.getByText("Failed to send: Unknown slash command: /xyz"),
      ).toBeTruthy(),
    );
  });

  it("clamps arrow navigation and Tab-completes without execution", () => {
    commandFixtures = [
      compactDefinition,
      {
        command: "continue",
        name: "continue",
        description: "Continue the session",
        accepts_arguments: false,
      },
    ];
    const textarea = composer();
    type(textarea, "/c");

    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(
      screen.getByRole("option", { name: /continue/i }).getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(
      screen.getByRole("option", { name: /continue/i }).getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    fireEvent.keyDown(textarea, { key: "Tab" });

    expect(textarea.value).toBe("/continue");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(fakes.compactSession).not.toHaveBeenCalled();
    expect(fakes.submitRun).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
  });

  it("first Enter completes and the subsequent Enter executes compact", async () => {
    const textarea = composer();
    type(textarea, "/co");

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea.value).toBe("/compact");
    expect(fakes.compactSession).not.toHaveBeenCalled();
    expect(fakes.submitRun).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() =>
      expect(fakes.compactSession).toHaveBeenCalledWith("session"),
    );
    expect(fakes.submitRun).not.toHaveBeenCalled();
  });

  it("Send completes an active suggestion before executing it", async () => {
    const textarea = composer();
    type(textarea, "/co");
    const send = screen.getByRole("button", { name: "Send" });

    fireEvent.click(send);
    expect(textarea.value).toBe("/compact");
    expect(fakes.compactSession).not.toHaveBeenCalled();
    expect(fakes.submitRun).not.toHaveBeenCalled();

    fireEvent.click(send);
    await waitFor(() =>
      expect(fakes.compactSession).toHaveBeenCalledWith("session"),
    );
    expect(fakes.submitRun).not.toHaveBeenCalled();
  });

  it("pointer completion keeps focus and argument commands append one space", () => {
    commandFixtures = [
      {
        command: "run",
        name: "run",
        description: "Run a workset",
        accepts_arguments: true,
      },
    ];
    const textarea = composer();
    type(textarea, "/r");
    const option = screen.getByRole("option", { name: /run/i });

    fireEvent.pointerDown(option);
    fireEvent.click(option);

    expect(textarea.value).toBe("/run ");
    expect(textarea.selectionStart).toBe(5);
    expect(document.activeElement).toBe(textarea);
    expect(fakes.compactSession).not.toHaveBeenCalled();
    expect(fakes.submitRun).not.toHaveBeenCalled();
  });

  it("keeps Escape and completion dismissed until the value changes", () => {
    const textarea = composer();
    type(textarea, "/");
    fireEvent.keyDown(textarea, { key: "Escape" });
    textarea.blur();
    textarea.focus();
    expect(screen.queryByRole("listbox")).toBeNull();

    type(textarea, "/c");
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(textarea, { key: "Tab" });
    expect(screen.queryByRole("listbox")).toBeNull();

    type(textarea, "/compac");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("preserves Shift+Enter and ignores popup and submit keys during composition", () => {
    const textarea = composer();
    type(textarea, "/c");

    fireEvent.keyDown(textarea, { key: "ArrowDown", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Tab", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Escape", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(textarea.value).toBe("/c");
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(fakes.compactSession).not.toHaveBeenCalled();
    expect(fakes.submitRun).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(fakes.compactSession).not.toHaveBeenCalled();
    expect(fakes.submitRun).not.toHaveBeenCalled();
  });

  it("deduplicates submits while command metadata is loading", async () => {
    const pending = Promise.withResolvers<SlashCommandDefinition[]>();
    commandFixtures = undefined;
    // A failed mount fetch leaves the query idle with no data, so the
    // component's own refetch is the call that reaches the fake.
    fakes.listCommands.mockRejectedValue(new Error("mount skipped"));
    const textarea = composer();
    await waitFor(() => expect(fakes.listCommands).toHaveBeenCalledOnce());
    fakes.listCommands.mockClear();
    fakes.listCommands.mockReturnValueOnce(pending.promise);
    type(textarea, "/compact");
    fireEvent.keyDown(textarea, { key: "Escape" });

    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(fakes.listCommands).toHaveBeenCalledOnce();

    pending.resolve([compactDefinition]);
    await waitFor(() => expect(fakes.compactSession).toHaveBeenCalledOnce());
  });

  it("gates slash submission on metadata but leaves ordinary prompts available", async () => {
    commandFixtures = undefined;
    // A failed mount fetch leaves the query idle with no data, so the
    // component's own refetch is the call that reaches the fake.
    fakes.listCommands.mockRejectedValue(new Error("mount skipped"));
    const textarea = composer();
    await waitFor(() => expect(fakes.listCommands).toHaveBeenCalledOnce());
    fakes.listCommands.mockClear();
    fakes.listCommands.mockResolvedValue([compactDefinition]);
    type(textarea, "/compact");
    fireEvent.keyDown(textarea, { key: "Escape" });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(fakes.listCommands).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(fakes.compactSession).toHaveBeenCalledWith("session"),
    );

    cleanup();
    commandFixtures = undefined;
    fakes.listCommands.mockRejectedValue(new Error("unavailable"));
    const failedTextarea = composer();
    await waitFor(() => expect(fakes.listCommands).toHaveBeenCalled());
    type(failedTextarea, "/compact");
    fireEvent.keyDown(failedTextarea, { key: "Escape" });
    fireEvent.keyDown(failedTextarea, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByText("Unable to load slash commands")).toBeTruthy(),
    );
    expect(fakes.compactSession).toHaveBeenCalledTimes(1);

    cleanup();
    commandFixtures = undefined;
    const ordinaryTextarea = composer();
    type(ordinaryTextarea, "ordinary prompt");
    fireEvent.keyDown(ordinaryTextarea, { key: "Enter" });
    await waitFor(() =>
      expect(fakes.submitRun).toHaveBeenCalledWith("session", "ordinary prompt"),
    );
  });
});
