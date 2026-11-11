/** @vitest-environment jsdom */
import type { ILinkHandler, ITerminalOptions } from "@xterm/xterm";
import { afterEach, expect, it, vi } from "vitest";
import { createTerminalRenderer } from "./xtermAdapter";

const factory = vi.hoisted(() => ({ make: vi.fn() }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    constructor(options: ITerminalOptions) {
      Object.assign(this, factory.make(options));
    }
  },
}));
const releases: Array<() => void> = [];
afterEach(() => {
  for (const dispose of releases.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function fixture(
  mode: "browser" | "native-visible-anchor" | "omitted" = "native-visible-anchor",
) {
  const listeners = vi.spyOn(EventTarget.prototype, "addEventListener");
  const parent = document.createElement("div");
  const host = document.createElement("div");
  const textarea = document.createElement("textarea");
  host.append(textarea);
  parent.append(host);
  document.body.append(parent);
  let handler!: ILinkHandler;
  let scroll!: () => void;
  let resize!: () => void;
  let selection!: () => void;
  const disposeScroll = vi.fn(),
    disposeResize = vi.fn(),
    disposeSelection = vi.fn(),
    disposeClipboard = vi.fn();
  const view = {
    element: host,
    textarea,
    options: { disableStdin: false },
    open: vi.fn(),
    hasSelection: vi.fn(() => false),
    reset: vi.fn(),
    dispose: vi.fn(),
    onScroll: vi.fn((callback: () => void) => {
      scroll = callback;
      return { dispose: disposeScroll };
    }),
    onResize: vi.fn((callback: () => void) => {
      resize = callback;
      return { dispose: disposeResize };
    }),
    onSelectionChange: vi.fn((callback: () => void) => {
      selection = callback;
      return { dispose: disposeSelection };
    }),
    write: vi.fn((_bytes: Uint8Array, done: () => void) => done()),
    parser: { registerOscHandler: vi.fn(() => ({ dispose: disposeClipboard })) },
  };
  factory.make.mockImplementation((options: ITerminalOptions) => {
    handler = options.linkHandler!;
    return view;
  });
  const adapter =
    mode === "omitted"
      ? await createTerminalRenderer(parent)
      : await createTerminalRenderer(parent, { linkMode: mode });
  releases.push(adapter.dispose);
  // Mock callback intent only; never a claim of trusted/native input.
  const trusted = { isTrusted: true } as MouseEvent;
  const range = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } };
  const hover = (uri = "https://example.test/report") => handler.hover?.(trusted, uri, range);
  const activate = (uri = "https://example.test/report") => handler.activate(trusted, uri, range);
  const trustedClose = () => {
    const button = host.querySelector("button")!;
    const index = listeners.mock.calls.findIndex(
      (args, i) => args[0] === "click" && listeners.mock.contexts[i] === button,
    );
    const listener = listeners.mock.calls[index][1] as (event: MouseEvent) => void;
    // Callback-state control only; real trusted click/Enter is an E2E obligation.
    listener({ isTrusted: true, stopPropagation: vi.fn() } as unknown as MouseEvent);
  };
  const trustedCellClick = () => {
    const index = listeners.mock.calls.findIndex(
      (args, i) => args[0] === "click" && listeners.mock.contexts[i] === host,
    );
    const listener = listeners.mock.calls[index][1] as (event: MouseEvent) => void;
    const stopPropagation = vi.fn();
    listener({ isTrusted: true, stopPropagation } as unknown as MouseEvent);
    return stopPropagation;
  };
  return {
    parent,
    host,
    textarea,
    view,
    adapter,
    hover,
    activate,
    handler,
    range,
    trustedClose,
    trustedCellClick,
    selection: () => selection(),
    scroll: () => scroll(),
    resize: () => resize(),
    disposeScroll,
    disposeResize,
    disposeSelection,
    disposeClipboard,
    anchor: () => host.querySelector<HTMLAnchorElement>(".nac-terminal-link a"),
  };
}

it("hover reveals a literal real anchor without opening or stealing input focus", async () => {
  const f = await fixture();
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  f.textarea.focus();
  f.hover("https://example.test/path?q=hello%20world#part");
  const link = f.anchor()!;
  expect(link.tagName).toBe("A");
  expect(link.href).toBe("https://example.test/path?q=hello%20world#part");
  expect(link.textContent).toBe("Open https://example.test/…");
  expect(link.getAttribute("aria-label")).toBe(
    "Open terminal link in browser at https://example.test; destination details hidden",
  );
  expect(link.target).toBe("_blank");
  expect(link.rel).toBe("noopener noreferrer");
  expect(document.activeElement).toBe(f.textarea);
  expect(open).not.toHaveBeenCalled();
});
it("cell activation focuses the visible link but does not dispatch an anchor click", async () => {
  const f = await fixture();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  f.textarea.focus();
  f.activate();
  expect(document.activeElement).toBe(f.anchor());
  expect(click).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(f.trustedCellClick()).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(f.anchor());
});
it.each([
  "javascript:alert(1)",
  "file:///tmp/a",
  "mailto:a@example.test",
  "not a URL",
  "https://user:secret@example.test/a",
  "https://example.test/" + "x".repeat(8192),
])("refuses unsafe/unbounded destination %s", async (uri) => {
  const f = await fixture();
  f.hover(uri);
  expect(f.anchor()).toBeNull();
});
it("rejects synthetic callbacks and synthetic activation of the displayed anchor", async () => {
  const f = await fixture();
  f.handler.activate(new MouseEvent("mouseup"), "https://example.test/", f.range);
  expect(f.anchor()).toBeNull();
  f.hover();
  expect(
    f.anchor()!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
  ).toBe(false);
});
it("never retargets an already focused link merely because another cell is hovered", async () => {
  const f = await fixture();
  f.activate("https://example.test/first");
  f.hover("https://example.test/second");
  expect(f.anchor()!.href).toBe("https://example.test/first");
});
it("retires stale links on output, reset, scroll and resize", async () => {
  const f = await fixture();
  for (const retire of [
    () => f.adapter.renderer.write(new Uint8Array([65]), new AbortController().signal),
    () => f.adapter.renderer.reset("gap", new AbortController().signal),
    f.scroll,
    f.resize,
    f.selection,
  ]) {
    f.hover();
    await retire();
    expect(f.anchor()).toBeNull();
  }
});
it("does not interfere with an existing text selection", async () => {
  const f = await fixture();
  f.view.hasSelection.mockReturnValue(true);
  f.activate();
  expect(f.anchor()).toBeNull();
});
it("isolates widget pointer events while leaving the real anchor default unmodified by pointer handlers", async () => {
  const f = await fixture();
  f.hover();
  const owner = vi.fn();
  f.host.addEventListener("mousedown", owner);
  expect(
    f.anchor()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })),
  ).toBe(true);
  expect(owner).not.toHaveBeenCalled();
});
it("cleans timers, subscriptions and retained hrefs without focusing a retired terminal", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  f.hover();
  const link = f.anchor()!;
  f.handler.leave?.({} as MouseEvent, link.href, f.range);
  f.adapter.dispose();
  expect(f.anchor()).toBeNull();
  expect(link.hasAttribute("href")).toBe(false);
  expect(f.disposeScroll).toHaveBeenCalledOnce();
  expect(f.disposeResize).toHaveBeenCalledOnce();
  expect(f.disposeClipboard).toHaveBeenCalledOnce();
  expect(f.disposeSelection).toHaveBeenCalledOnce();
  f.activate();
  expect(f.anchor()).toBeNull();
  f.handler.leave?.({} as MouseEvent, "https://example.test/", f.range);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["omitted", "browser"] as const)(
  "keeps the exact %s browser/hosted one-cell-click path without native subscriptions",
  async (mode) => {
    const f = await fixture(mode);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    f.textarea.focus();
    f.activate("https://example.test/path?key=fixture-secret#fragment");
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "https://example.test/path?key=fixture-secret#fragment",
      "_blank",
      "noopener,noreferrer",
    );
    expect(f.anchor()).toBeNull();
    expect(f.view.onScroll).not.toHaveBeenCalled();
    expect(f.view.onResize).not.toHaveBeenCalled();
    expect(f.view.onSelectionChange).not.toHaveBeenCalled();
    expect(f.handler.hover).toBeUndefined();
    expect(document.activeElement).toBe(f.textarea);
    f.handler.activate(new MouseEvent("mouseup"), "https://example.test/", f.range);
    expect(open).toHaveBeenCalledTimes(1);
  },
);

it("restores input focus only from explicit Close on an eligible current owner", async () => {
  const f = await fixture();
  f.textarea.focus();
  f.activate();
  f.trustedClose();
  expect(document.activeElement).toBe(f.textarea);
  f.textarea.focus();
  f.activate();
  f.view.options.disableStdin = true;
  const focus = vi.spyOn(f.textarea, "focus");
  f.trustedClose();
  expect(focus).not.toHaveBeenCalled();
  expect(f.anchor()).toBeNull();
});
it("Close stops the frame click and synthetic Close cannot restore input", async () => {
  const f = await fixture();
  f.textarea.focus();
  f.activate();
  const owner = vi.fn();
  f.parent.addEventListener("click", owner);
  const focus = vi.spyOn(f.textarea, "focus");
  f.host.querySelector("button")!.click();
  expect(owner).not.toHaveBeenCalled();
  expect(focus).not.toHaveBeenCalled();
  expect(f.anchor()).toBeNull();
});
it("clears on blur/hidden document and refuses a tampered or detached href", async () => {
  const f = await fixture();
  f.hover();
  const old = f.anchor()!;
  old.href = "https://foreign.example.test/";
  expect(old.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(
    false,
  );
  window.dispatchEvent(new Event("blur"));
  expect(f.anchor()).toBeNull();
  expect(old.hasAttribute("href")).toBe(false);
  f.hover();
  expect(f.anchor()).toBeNull();
  window.dispatchEvent(new Event("focus"));
  f.hover();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(f.anchor()).toBeNull();
  f.hover();
  expect(f.anchor()).toBeNull();
  f.parent.remove();
  f.activate();
  expect(f.anchor()).toBeNull();
});
it("never exposes native URL path/query/fragment in text, accessible name, title or dataset", async () => {
  const f = await fixture();
  f.hover("https://example.test/reset/SECRET_PATH?token=SECRET_QUERY#SECRET_FRAGMENT");
  const link = f.anchor()!;
  expect(link.href).toContain("SECRET_QUERY"); // Ephemeral real navigation target, not a log/display field.
  expect(link.textContent).toBe("Open https://example.test/…");
  expect(link.getAttribute("aria-label")).not.toContain("SECRET");
  expect(link.hasAttribute("title")).toBe(false);
  expect(Object.values(link.dataset).join()).not.toContain("SECRET");
});
