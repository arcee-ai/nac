import type { RefObject } from "react";

/**
 * What an open overlay is to the presentation instance that owns it.
 *
 * - `modal` blocks the view behind it: shortcuts stay off, and a phone panel
 *   slides aside for a modal opened above it.
 * - `sheet` covers the view with a scrim of its own, like a modal, but leaves
 *   shortcuts and the panels behind it alone.
 * - `panel` is an anchored popup (popover, menu) that a press outside dismisses.
 * - `hint` is a tooltip. It takes Escape first, but never stands in the way of a
 *   press meant for the layer below it.
 */
export type LayerKind = "modal" | "sheet" | "panel" | "hint";

export interface LayerHandlers {
  kind: LayerKind;
  content: RefObject<HTMLElement | null>;
  /** Trigger area of a panel: pressing it is not an outside press. */
  anchor?: RefObject<HTMLElement | null>;
  /** Absent: the layer swallows Escape without closing, so nothing below it closes either. */
  onEscape?: () => void;
  /** Panels only. Absent: presses outside the panel pass on to the layer below it. */
  onOutsidePress?: () => void;
  inertBackground: boolean;
  ownsKeyboard: (target: EventTarget | null) => boolean;
  inertTarget: HTMLElement | null;
}

interface Layer {
  token: object;
  handlers: RefObject<LayerHandlers | null>;
  returnFocus: HTMLElement | null;
  restoreFocus: boolean;
  pressedInside: boolean;
}

export interface LayerStack {
  subscribe: (listener: () => void) => () => void;
  /** Open modal layers. Global shortcuts stay off while any is open. */
  modalDepth: () => number;
  /** Whether `token` is the topmost layer, hints left out unless asked for. */
  isTop: (token: object, includeHints?: boolean) => boolean;
  /** Whether a modal opened after `token` is still open. */
  hasModalAbove: (token: object) => boolean;
  open: (token: object, handlers: RefObject<LayerHandlers | null>, opener: Element | null) => void;
  close: (token: object) => void;
  /** The next close of `token` leaves focus where it is: the user already moved on. */
  skipFocusRestore: (token: object) => void;
  /** Marks a press that started inside the layer's React tree, portals included. */
  markPressInside: (token: object) => void;
  /** Re-applies background inertness after a layer changed its handlers. */
  refresh: () => void;
}

export const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusLost(active: Element | null): boolean {
  return !active || active === active.ownerDocument.body || !active.isConnected;
}

/**
 * The overlay stack of one presentation instance. It is the single owner of
 * Escape, outside-press dismissal, background inertness and focus return for
 * every primitive in `ui/`: Radix still portals, positions and wires ARIA, but
 * its document-wide layer handling is suppressed so that two embedded instances
 * — or a host page with overlays of its own — never close each other's layers.
 */
export function createLayerStack(): LayerStack {
  let layers: Layer[] = [];
  const listeners = new Set<() => void>();
  let inertApplied: HTMLElement | null = null;
  let pendingRestore: { target: HTMLElement; content: HTMLElement | null; timer: number } | null =
    null;

  const handlersOf = (layer: Layer) => layer.handlers.current;
  const kindOf = (layer: Layer) => handlersOf(layer)?.kind;
  const notify = () => listeners.forEach((listener) => listener());
  const lastLayer = (matches: (layer: Layer) => boolean) => {
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      if (matches(layers[index])) return layers[index];
    }
    return undefined;
  };

  const syncInert = () => {
    const blocking = lastLayer((layer) => !!handlersOf(layer)?.inertBackground);
    const target = blocking ? (handlersOf(blocking)?.inertTarget ?? null) : null;
    if (inertApplied && inertApplied !== target) {
      inertApplied.removeAttribute("inert");
      inertApplied = null;
    }
    if (target && inertApplied !== target) {
      target.setAttribute("inert", "");
      inertApplied = target;
    }
  };

  // Bubble phase on purpose: a field that handles Escape itself stops the
  // propagation, and the layers then keep their state.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing) return;
    const top = layers.at(-1);
    const handlers = top && handlersOf(top);
    if (!top || !handlers?.ownsKeyboard(event.target)) return;
    top.restoreFocus = true;
    handlers.onEscape?.();
  };

  const resetPresses = () => {
    for (const layer of layers) layer.pressedInside = false;
  };

  const onMouseDown = (event: MouseEvent) => {
    const node = event.target instanceof Node ? event.target : null;
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const layer = layers[index];
      const handlers = handlersOf(layer);
      if (!handlers || handlers.kind === "hint") continue;
      // Modals and sheets decide about presses outside them through their scrim.
      if (handlers.kind !== "panel") return;
      if (layer.pressedInside) return;
      if (node && handlers.content.current?.contains(node)) return;
      if (node && handlers.anchor?.current?.contains(node)) return;
      if (handlers.onOutsidePress) {
        layer.restoreFocus = false;
        handlers.onOutsidePress();
        return;
      }
    }
  };

  const attach = () => {
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", resetPresses, true);
    document.addEventListener("mousedown", onMouseDown);
  };
  const detach = () => {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("mousedown", resetPresses, true);
    document.removeEventListener("mousedown", onMouseDown);
  };

  const find = (token: object) => layers.find((layer) => layer.token === token);

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    modalDepth: () => layers.filter((layer) => kindOf(layer) === "modal").length,
    isTop: (token, includeHints = false) =>
      lastLayer((layer) => includeHints || kindOf(layer) !== "hint")?.token === token,
    hasModalAbove: (token) => {
      const index = layers.findIndex((layer) => layer.token === token);
      return index >= 0 && layers.slice(index + 1).some((layer) => kindOf(layer) === "modal");
    },
    open: (token, handlers, opener) => {
      if (find(token)) return;
      let returnFocus: HTMLElement | null = null;
      if (handlers.current?.kind !== "hint") {
        const content = handlers.current?.content.current;
        const usable =
          opener instanceof HTMLElement &&
          !focusLost(opener) &&
          !content?.contains(opener) &&
          !pendingRestore?.content?.contains(opener);
        // A layer that replaces the one just closed — a menu row opening a
        // dialog — inherits the focus that layer was about to hand back. A
        // phone sheet retains its DOM during exit, so its row is still connected
        // but belongs to the closing content, not a usable return destination.
        returnFocus = usable ? opener : (pendingRestore?.target ?? null);
        if (pendingRestore) window.clearTimeout(pendingRestore.timer);
        pendingRestore = null;
      }
      layers = [
        ...layers,
        { token, handlers, returnFocus, restoreFocus: true, pressedInside: false },
      ];
      if (layers.length === 1) attach();
      syncInert();
      notify();
    },
    close: (token) => {
      const layer = find(token);
      if (!layer) return;
      layers = layers.filter((entry) => entry !== layer);
      if (layers.length === 0) detach();
      syncInert();
      notify();
      const handlers = handlersOf(layer);
      if (!layer.restoreFocus || !handlers || handlers.kind === "hint") return;
      const content = handlers.content.current;
      const active = document.activeElement;
      // Focus that already moved on elsewhere is left where the user put it.
      if (!focusLost(active) && !content?.contains(active)) return;
      const target = layer.returnFocus?.isConnected
        ? layer.returnFocus
        : (handlers.anchor?.current?.querySelector<HTMLElement>(FOCUSABLE) ?? null);
      if (!target) return;
      if (pendingRestore) window.clearTimeout(pendingRestore.timer);
      const restore = { target, content, timer: 0 };
      restore.timer = window.setTimeout(() => {
        if (pendingRestore !== restore) return;
        pendingRestore = null;
        const current = document.activeElement;
        if (focusLost(current) || content?.contains(current)) target.focus({ preventScroll: true });
      }, 0);
      pendingRestore = restore;
    },
    skipFocusRestore: (token) => {
      const layer = find(token);
      if (layer) layer.restoreFocus = false;
    },
    markPressInside: (token) => {
      const layer = find(token);
      if (layer) layer.pressedInside = true;
    },
    refresh: syncInert,
  };
}
