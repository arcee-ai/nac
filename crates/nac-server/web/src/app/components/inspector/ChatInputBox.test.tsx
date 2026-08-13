/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatInputBox } from "@/app/components/inspector/ChatInputBox";
import type { SlashCommandDefinition } from "@/app/types/api";

const mocks = vi.hoisted(() => ({
  commands: {
    data: undefined as SlashCommandDefinition[] | undefined,
    isError: false,
    refetch: vi.fn(),
  },
  compact: vi.fn(),
  submit: vi.fn(),
  toastError: vi.fn(),
  pushLocalEvent: vi.fn(),
}));

vi.mock("@/app/components/inspector/ModelPicker", () => ({
  ModelPicker: () => null,
}));

vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
}));

vi.mock("@/app/hooks/useNow", () => ({ useNow: () => 0 }));
vi.mock("@/app/lib/perfDebug", () => ({ perfRender: vi.fn() }));

vi.mock("@/app/providers/ToastProvider", () => ({
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  useToast: () => ({ error: mocks.toastError }),
}));

vi.mock("@/app/providers/SessionActionsProvider", () => ({
  useSessionActions: () => ({ settings: vi.fn(), stopRun: vi.fn() }),
}));

vi.mock("@/app/services/queries", () => ({
  useCompactSession: () => ({
    isPending: false,
    mutateAsync: mocks.compact,
  }),
  useModelCatalog: () => ({ data: undefined }),
  useSlashCommands: () => mocks.commands,
  useSshConnect: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSubmitRun: () => ({ isPending: false, mutateAsync: mocks.submit }),
}));

vi.mock("@/app/store/runtimeStore", () => ({
  pushLocalEvent: mocks.pushLocalEvent,
  useRunning: () => false,
  useRunUsage: () => null,
}));

vi.mock("@/app/store/sshConnectionStore", () => ({
  markSshConnected: vi.fn(),
  markSshDisconnected: vi.fn(),
  sshTargetFromSummary: () => null,
  useSshConnectionStatus: () => "disconnected",
}));

const compactDefinition: SlashCommandDefinition = {
  command: "compact",
  name: "compact",
  description: "Compact the current session context",
  accepts_arguments: false,
};

function composer() {
  render(<ChatInputBox sessionId="session" snapshot={null} entry={null} />);
  const textarea = screen.getByRole("combobox", { name: "Message" });
  textarea.focus();
  return textarea as HTMLTextAreaElement;
}

function type(textarea: HTMLTextAreaElement, value: string) {
  fireEvent.change(textarea, { target: { value } });
}

beforeEach(() => {
  mocks.commands.data = [compactDefinition];
  mocks.commands.isError = false;
  mocks.commands.refetch.mockReset().mockResolvedValue({
    data: [compactDefinition],
  });
  mocks.compact.mockReset().mockResolvedValue({
    status: "compacted",
    compaction_id: "compaction",
  });
  mocks.submit.mockReset().mockResolvedValue({
    run_id: "run",
    client_id: null,
    display_prompt: "prompt",
  });
  mocks.toastError.mockReset();
  mocks.pushLocalEvent.mockReset();
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
    mocks.submit.mockRejectedValueOnce(
      new Error("unknown slash command: /xyz"),
    );
    type(textarea, "/xyz");

    expect(screen.getByRole("listbox").textContent).toContain(
      "No matching commands",
    );
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("/xyz");

    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith({
        id: "session",
        prompt: "/xyz",
      }),
    );
    expect(mocks.compact).not.toHaveBeenCalled();
    await waitFor(() =>
      // The composer reports through `humanErrorText`, which opens a backend
      // message as a sentence — the server sends this one lower-case.
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Failed to send: Unknown slash command: /xyz",
      ),
    );
  });

  it("clamps arrow navigation and Tab-completes without execution", () => {
    mocks.commands.data = [
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
    expect(mocks.compact).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
  });

  it("first Enter completes and the subsequent Enter executes compact", async () => {
    const textarea = composer();
    type(textarea, "/co");

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea.value).toBe("/compact");
    expect(mocks.compact).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(mocks.compact).toHaveBeenCalledWith("session"));
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("Send completes an active suggestion before executing it", async () => {
    const textarea = composer();
    type(textarea, "/co");
    const send = screen.getByRole("button", { name: "Send" });

    fireEvent.click(send);
    expect(textarea.value).toBe("/compact");
    expect(mocks.compact).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();

    fireEvent.click(send);
    await waitFor(() => expect(mocks.compact).toHaveBeenCalledWith("session"));
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("pointer completion keeps focus and argument commands append one space", () => {
    mocks.commands.data = [
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
    expect(mocks.compact).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
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
    expect(mocks.compact).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(mocks.compact).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("deduplicates submits while command metadata is loading", async () => {
    const pending =
      Promise.withResolvers<{ data: SlashCommandDefinition[] }>();
    mocks.commands.data = undefined;
    mocks.commands.refetch.mockReturnValueOnce(pending.promise);
    const textarea = composer();
    type(textarea, "/compact");
    fireEvent.keyDown(textarea, { key: "Escape" });

    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mocks.commands.refetch).toHaveBeenCalledOnce();

    pending.resolve({ data: [compactDefinition] });
    await waitFor(() => expect(mocks.compact).toHaveBeenCalledOnce());
  });

  it("gates slash submission on metadata but leaves ordinary prompts available", async () => {
    mocks.commands.data = undefined;
    const textarea = composer();
    type(textarea, "/compact");
    fireEvent.keyDown(textarea, { key: "Escape" });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(mocks.commands.refetch).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.compact).toHaveBeenCalledWith("session"));

    cleanup();
    mocks.commands.data = undefined;
    mocks.commands.refetch.mockResolvedValueOnce({ data: undefined });
    const failedTextarea = composer();
    type(failedTextarea, "/compact");
    fireEvent.keyDown(failedTextarea, { key: "Escape" });
    fireEvent.keyDown(failedTextarea, { key: "Enter" });
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Unable to load slash commands",
      ),
    );
    expect(mocks.compact).toHaveBeenCalledTimes(1);

    cleanup();
    mocks.commands.data = undefined;
    const ordinaryTextarea = composer();
    type(ordinaryTextarea, "ordinary prompt");
    fireEvent.keyDown(ordinaryTextarea, { key: "Enter" });
    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith({
        id: "session",
        prompt: "ordinary prompt",
      }),
    );
  });
});
