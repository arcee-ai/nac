/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { observeHumanTerminalInput } from "./humanInput";

const releases: Array<() => void> = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function fixture() {
  const host = document.createElement("div");
  const textarea = document.createElement("textarea");
  host.append(textarea);
  document.body.append(host);
  const listeners = new Map<string, EventListener>();
  for (const element of [host, textarea]) {
    vi.spyOn(element, "addEventListener").mockImplementation((name, listener) => {
      listeners.set(name, listener as EventListener);
    });
    vi.spyOn(element, "removeEventListener").mockImplementation((name) => {
      listeners.delete(name);
    });
  }
  let data!: (value: string) => void;
  let binary!: (value: string) => void;
  let key!: (value: { key: string; domEvent: KeyboardEvent }) => void;
  const disposals = [vi.fn(), vi.fn(), vi.fn()];
  const terminal = {
    element: host,
    textarea,
    onData: (callback: typeof data) => {
      data = callback;
      return { dispose: disposals[0] };
    },
    onBinary: (callback: typeof binary) => {
      binary = callback;
      return { dispose: disposals[1] };
    },
    onKey: (callback: typeof key) => {
      key = callback;
      return { dispose: disposals[2] };
    },
    paste: vi.fn((value: string) => data(`native-paste:${value}`)),
  };
  const send = vi.fn();
  const close = observeHumanTerminalInput(terminal as unknown as Terminal, send);
  releases.push(close);
  return {
    terminal,
    textarea,
    send,
    close,
    disposals,
    listeners,
    data: (value: string) => data(value),
    binary: (value: string) => binary(value),
    key: (value: string, isTrusted = true) =>
      key({ key: value, domEvent: { isTrusted } as KeyboardEvent }),
    event: (name: string, isTrusted = true) => listeners.get(name)?.({ isTrusted } as Event),
    texts: () => send.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes)),
  };
}

describe("public human terminal input origin", () => {
  it("keeps focused parser output inert and requires a trusted focused key", () => {
    const f = fixture();
    f.key("unfocused");
    f.textarea.focus();
    f.data("\u001b[9;1R");
    f.key("spoofed", false);
    expect(f.send).not.toHaveBeenCalled();
    f.key("\u0003");
    f.key("Ω中");
    expect(f.texts()).toEqual(["\u0003", "Ω中"]);
  });

  it("delegates trusted paste encoding to the public terminal exactly once", () => {
    const f = fixture();
    f.textarea.focus();
    const event = {
      isTrusted: true,
      clipboardData: { getData: vi.fn(() => "literal\nΩ中") },
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    f.listeners.get("paste")?.({ ...event, isTrusted: false } as unknown as Event);
    expect(f.terminal.paste).not.toHaveBeenCalled();
    f.listeners.get("paste")?.(event as unknown as Event);
    expect(f.terminal.paste).toHaveBeenCalledExactlyOnceWith("literal\nΩ中");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    f.data("late parser reply");
    expect(f.texts()).toEqual(["native-paste:literal\nΩ中"]);
  });

  it("commits actual IME text once before an interrupting key and ignores native echo", async () => {
    const f = fixture();
    f.textarea.focus();
    f.textarea.value = "prior";
    f.event("compositionstart");
    f.textarea.value = "priorΩ中";
    f.event("input");
    f.textarea.value = "priorforged late text";
    f.event("compositionend", false);
    f.key("\r");
    await Promise.resolve();
    f.data("Ω中");
    expect(f.texts()).toEqual(["Ω中", "\r"]);
  });

  it("never creates composition authority from a synthetic end or untrusted edit", async () => {
    const f = fixture();
    f.textarea.focus();
    f.event("compositionstart", false);
    f.textarea.value = "forged";
    f.event("input", false);
    f.event("compositionend", false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.send).not.toHaveBeenCalled();
    f.event("compositionstart");
    f.textarea.value = "forgedlater";
    f.event("input", false);
    f.event("compositionend", false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.send).not.toHaveBeenCalled();
  });

  it("fences an abandoned composition commit and releases every listener", async () => {
    const f = fixture();
    f.textarea.focus();
    f.event("compositionstart");
    f.textarea.value = "private composition";
    f.event("input");
    f.event("compositionend");
    f.close();
    await Promise.resolve();
    f.key("late");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.listeners.size).toBe(0);
    for (const dispose of f.disposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it("admits binary pointer encoding only during a trusted focused dispatch", async () => {
    const f = fixture();
    f.textarea.focus();
    const current = vi.spyOn(window, "event", "get");
    const event = {
      isTrusted: true,
      type: "mousedown",
      target: f.textarea,
      currentTarget: f.terminal.element,
    };
    current.mockReturnValue({ ...event, isTrusted: false } as unknown as Event);
    f.binary("\u0080");
    expect(f.send).not.toHaveBeenCalled();
    current.mockReturnValue(event as unknown as Event);
    f.binary("\u0080\u0003");
    expect(Array.from(f.send.mock.calls[0][0])).toEqual([128, 3]);
    current.mockReturnValue({ ...event, currentTarget: null } as unknown as Event);
    f.binary("\u0080");
    current.mockReturnValue(undefined);
    await Promise.resolve();
    f.data("later query");
    expect(f.send).toHaveBeenCalledOnce();
  });
});
