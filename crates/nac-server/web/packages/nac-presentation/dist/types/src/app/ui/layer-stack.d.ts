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
export declare const FOCUSABLE = "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";
/**
 * The overlay stack of one presentation instance. It is the single owner of
 * Escape, outside-press dismissal, background inertness and focus return for
 * every primitive in `ui/`: Radix still portals, positions and wires ARIA, but
 * its document-wide layer handling is suppressed so that two embedded instances
 * — or a host page with overlays of its own — never close each other's layers.
 */
export declare function createLayerStack(): LayerStack;
