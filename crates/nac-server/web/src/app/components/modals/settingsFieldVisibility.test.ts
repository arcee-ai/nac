// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { observeSettingsFieldVisibility } from "./settingsFieldVisibility";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fixture(doc = document) {
  const view = doc.defaultView!;
  const callbacks: (() => void)[] = [];
  const disconnect = vi.fn();
  class Observer {
    constructor(callback: () => void) {
      callbacks.push(callback);
    }
    observe() {}
    disconnect = disconnect;
  }
  Object.defineProperty(view, "ResizeObserver", { configurable: true, value: Observer });
  const host = doc.createElement("div");
  const body = doc.createElement("div");
  const content = doc.createElement("div");
  const input = doc.createElement("input");
  host.append(body);
  body.append(content);
  content.append(input);
  doc.body.append(host);
  body.style.padding = "16px";
  body.scrollTop = 767;
  let height = 721;
  let fieldTop = 816;
  let fieldHeight = 48;
  Object.defineProperty(body, "clientHeight", { get: () => height });
  vi.spyOn(body, "getBoundingClientRect").mockImplementation(
    () => ({ top: 129, bottom: 129 + height }) as DOMRect,
  );
  vi.spyOn(input, "getBoundingClientRect").mockImplementation(() => {
    const top = fieldTop - (body.scrollTop - 767);
    return { top, bottom: top + fieldHeight, height: fieldHeight } as DOMRect;
  });
  const dispose = observeSettingsFieldVisibility(content)!;
  cleanups.push(dispose);
  return {
    host,
    body,
    content,
    input,
    disconnect,
    dispose,
    resize: (next: number) => {
      height = next;
      callbacks.forEach((callback) => callback());
    },
    field: (top: number, size = 48) => {
      fieldTop = top;
      fieldHeight = size;
    },
  };
}

test("reveals the whole field after native focus scrolling without changing draft or caret", async () => {
  const f = fixture();
  f.input.value = "48000";
  f.input.focus();
  f.input.setSelectionRange(2, 4);
  // Native focus/caret scrolling can run after focusin; read its final geometry.
  f.body.scrollTop = 767;
  expect(f.body.scrollTop).toBe(767);
  await flush();
  expect(f.body.scrollTop).toBe(797);
  expect(f.input.getBoundingClientRect().bottom).toBe(834);
  expect(document.activeElement).toBe(f.input);
  expect(f.input.value).toBe("48000");
  expect([f.input.selectionStart, f.input.selectionEnd]).toEqual([2, 4]);
  expect(f.host.scrollTop).toBe(0);
  expect(document.documentElement.scrollTop).toBe(0);
});

test("reveals an already-focused field on body resize and later caret input scrolling", async () => {
  const f = fixture();
  f.input.focus();
  await flush();
  f.resize(691);
  await flush();
  expect(f.body.scrollTop).toBe(827);
  expect(f.input.getBoundingClientRect().bottom).toBe(804);
  f.body.scrollTop = 767;
  f.input.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
  expect(f.body.scrollTop).toBe(827);
});

test("keeps safe controls still, reveals above, and leaves oversized controls native", async () => {
  const f = fixture();
  f.field(300);
  f.input.focus();
  await flush();
  expect(f.body.scrollTop).toBe(767);
  f.field(130);
  f.resize(721);
  await flush();
  expect(f.body.scrollTop).toBe(752);
  f.field(100, 1000);
  f.resize(721);
  await flush();
  expect(f.body.scrollTop).toBe(752);
});

test("scopes resize work to the focused Settings instance", async () => {
  const first = fixture();
  const second = fixture();
  first.input.focus();
  await flush();
  second.resize(400);
  await flush();
  expect(first.body.scrollTop).toBe(797);
  expect(second.body.scrollTop).toBe(767);
});

test("uses the owning iframe realm instead of the host HTMLElement constructor", async () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const f = fixture(frame.contentDocument!);
  expect(f.input instanceof HTMLElement).toBe(false);
  f.input.focus();
  await flush();
  expect(f.body.scrollTop).toBe(797);
  expect(frame.contentDocument!.activeElement).toBe(f.input);
});

test("ignores other focused content, queued work after disposal, and detached instances", async () => {
  const f = fixture();
  const outside = document.createElement("input");
  document.body.append(outside);
  f.input.focus();
  outside.focus();
  await flush();
  expect(f.body.scrollTop).toBe(767);
  f.input.focus();
  f.dispose();
  await flush();
  expect(f.body.scrollTop).toBe(767);
  expect(f.disconnect).toHaveBeenCalled();
  const detached = fixture();
  detached.input.focus();
  detached.host.remove();
  await flush();
  expect(detached.body.scrollTop).toBe(767);
});
