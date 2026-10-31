/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLayerStack,
  type LayerHandlers,
  type LayerKind,
  type LayerStack,
} from "./layer-stack";

const opened: Array<[LayerStack, object]> = [];

function element<K extends keyof HTMLElementTagNameMap = "div">(tag?: K): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag ?? "div") as HTMLElementTagNameMap[K];
  document.body.append(node);
  return node;
}

function layer(
  stack: LayerStack,
  kind: LayerKind,
  overrides: Partial<LayerHandlers> = {},
  opener: Element | null = null,
) {
  const token = {};
  const content = element();
  const handlers: LayerHandlers = {
    kind,
    content: { current: content },
    inertBackground: false,
    ownsKeyboard: () => true,
    inertTarget: null,
    onEscape: vi.fn(() => stack.close(token)),
    ...overrides,
  };
  stack.open(token, { current: handlers }, opener);
  opened.push([stack, token]);
  return { token, content, handlers };
}

function escape(target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, ...init }));
}

function press(target: EventTarget) {
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
}

afterEach(() => {
  for (const [stack, token] of opened.splice(0)) stack.close(token);
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("Escape", () => {
  it("reaches only the topmost layer, a tooltip before the panel beneath it", () => {
    const stack = createLayerStack();
    const dialog = layer(stack, "modal");
    const menu = layer(stack, "panel");
    const hint = layer(stack, "hint");

    escape();
    expect(hint.handlers.onEscape).toHaveBeenCalledTimes(1);
    expect(menu.handlers.onEscape).not.toHaveBeenCalled();
    escape();
    expect(menu.handlers.onEscape).toHaveBeenCalledTimes(1);
    expect(dialog.handlers.onEscape).not.toHaveBeenCalled();
    escape();
    expect(dialog.handlers.onEscape).toHaveBeenCalledTimes(1);
    expect(stack.modalDepth()).toBe(0);
  });

  it("is swallowed by a layer that does not close on it", () => {
    const stack = createLayerStack();
    const dialog = layer(stack, "modal");
    layer(stack, "panel", { onEscape: undefined });

    escape();
    expect(dialog.handlers.onEscape).not.toHaveBeenCalled();
  });

  it("is left alone mid-composition, after a field handled it, and in another instance", () => {
    const stack = createLayerStack();
    const view = element();
    const dialog = layer(stack, "modal", {
      ownsKeyboard: (target) => target instanceof Node && view.contains(target),
    });
    const field = document.createElement("input");
    view.append(field);
    field.addEventListener("keydown", (event) => event.stopPropagation());

    escape(view, { isComposing: true });
    escape(field);
    escape(element());
    expect(dialog.handlers.onEscape).not.toHaveBeenCalled();

    escape(view);
    expect(dialog.handlers.onEscape).toHaveBeenCalledTimes(1);
  });
});

describe("outside presses", () => {
  it("dismiss a panel, except on its trigger, its content or its portalled React tree", () => {
    const stack = createLayerStack();
    const trigger = element("button");
    const onOutsidePress = vi.fn();
    const menu = layer(stack, "panel", { anchor: { current: trigger }, onOutsidePress });
    const nested = element();
    nested.addEventListener("mousedown", () => stack.markPressInside(menu.token), {
      capture: true,
    });

    press(trigger);
    press(menu.content);
    press(nested);
    expect(onOutsidePress).not.toHaveBeenCalled();

    press(element());
    expect(onOutsidePress).toHaveBeenCalledTimes(1);
  });

  it("pass through a hover panel and a tooltip to the panel below them", () => {
    const stack = createLayerStack();
    const onOutsidePress = vi.fn();
    layer(stack, "panel", { onOutsidePress });
    layer(stack, "panel");
    layer(stack, "hint");

    press(element());
    expect(onOutsidePress).toHaveBeenCalledTimes(1);
  });

  it("stop at a modal or a sheet, whose scrim decides about them", () => {
    for (const kind of ["modal", "sheet"] as const) {
      const stack = createLayerStack();
      const onOutsidePress = vi.fn();
      layer(stack, "panel", { onOutsidePress });
      layer(stack, kind);

      press(element());
      expect(onOutsidePress).not.toHaveBeenCalled();
    }
  });
});

describe("background", () => {
  it("is inert under the topmost blocking layer only while it is open", () => {
    const stack = createLayerStack();
    const content = element();
    const dialog = layer(stack, "modal", { inertBackground: true, inertTarget: content });
    expect(content.hasAttribute("inert")).toBe(true);

    const menu = layer(stack, "panel");
    expect(content.hasAttribute("inert")).toBe(true);

    stack.close(dialog.token);
    expect(content.hasAttribute("inert")).toBe(false);
    stack.close(menu.token);

    layer(stack, "modal", { inertTarget: content });
    expect(content.hasAttribute("inert")).toBe(false);
  });
});

describe("focus return", () => {
  it("goes back to the opener, unless the user already moved focus elsewhere", () => {
    vi.useFakeTimers();
    const stack = createLayerStack();
    const opener = element("button");
    opener.focus();

    const first = layer(stack, "modal", {}, opener);
    const field = document.createElement("input");
    first.content.append(field);
    field.focus();
    stack.close(first.token);
    vi.runAllTimers();
    expect(document.activeElement).toBe(opener);

    const second = layer(stack, "modal", {}, opener);
    const elsewhere = element("button");
    elsewhere.focus();
    stack.close(second.token);
    vi.runAllTimers();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("passes from a menu to the dialog its row opened, back to the menu's trigger", () => {
    vi.useFakeTimers();
    const stack = createLayerStack();
    const trigger = element("button");
    trigger.focus();
    const menu = layer(stack, "panel", { anchor: { current: trigger } }, trigger);
    const row = document.createElement("button");
    menu.content.append(row);
    row.focus();

    stack.close(menu.token);
    row.remove();
    const dialog = layer(stack, "modal", {}, document.activeElement);
    stack.close(dialog.token);
    vi.runAllTimers();
    expect(document.activeElement).toBe(trigger);
  });

  it.each([false, true])(
    "inherits a retained sheet's opener when the successor closes afterExit=%s",
    (afterExit) => {
      vi.useFakeTimers();
      const stack = createLayerStack();
      const trigger = element("button");
      trigger.focus();
      const sheet = layer(stack, "sheet", {}, trigger);
      const row = document.createElement("button");
      sheet.content.append(row);
      row.focus();
      stack.close(sheet.token);
      sheet.content.setAttribute("inert", "");
      const dialog = layer(stack, "modal", {}, row);
      const field = document.createElement("input");
      dialog.content.append(field);
      field.focus();
      // The canceled sheet restore must not steal focus from its successor.
      vi.advanceTimersByTime(1);
      expect(document.activeElement).toBe(field);
      if (afterExit) {
        sheet.content.remove();
        vi.advanceTimersByTime(300);
      }
      stack.close(dialog.token);
      vi.runAllTimers();
      expect(document.activeElement).toBe(trigger);
    },
  );

  it("keeps a deliberate opener outside the closing sheet instead of inheriting its target", () => {
    vi.useFakeTimers();
    const stack = createLayerStack();
    const trigger = element("button");
    const sheet = layer(stack, "sheet", {}, trigger);
    const row = document.createElement("button");
    sheet.content.append(row);
    row.focus();
    stack.close(sheet.token);
    const elsewhere = element("button");
    elsewhere.focus();
    const dialog = layer(stack, "modal", {}, elsewhere);
    dialog.content.tabIndex = -1;
    dialog.content.focus();
    stack.close(dialog.token);
    vi.runAllTimers();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("lets only the latest pending close restore focus", () => {
    vi.useFakeTimers();
    const stack = createLayerStack();
    const firstTrigger = element("button");
    const secondTrigger = element("button");
    const first = layer(stack, "panel", {}, firstTrigger);
    const second = layer(stack, "modal", {}, secondTrigger);
    const field = document.createElement("input");
    first.content.append(field);
    field.focus();
    stack.close(first.token);
    field.remove();
    stack.close(second.token);
    vi.runAllTimers();
    expect(document.activeElement).toBe(secondTrigger);
  });

  it("stays where an outside press that dismissed a panel left it", () => {
    vi.useFakeTimers();
    const stack = createLayerStack();
    const trigger = element("button");
    trigger.focus();
    const tokenRef: { current: object | null } = { current: null };
    const menu = layer(
      stack,
      "panel",
      { onOutsidePress: () => tokenRef.current && stack.close(tokenRef.current) },
      trigger,
    );
    tokenRef.current = menu.token;
    const field = document.createElement("input");
    menu.content.append(field);
    field.focus();

    press(element());
    vi.runAllTimers();
    expect(document.activeElement).toBe(field);
  });
});
