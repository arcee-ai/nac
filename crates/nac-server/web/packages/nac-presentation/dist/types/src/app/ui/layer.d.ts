import { type RefObject } from "react";
import type { LayerKind } from "./layer-stack";
/** Cancels a Radix dismissal: the layer stack decides what Escape and outside presses close. */
export declare const keepOpen: (event: Event) => void;
export interface LayerOptions {
    open: boolean;
    kind: LayerKind;
    content: RefObject<HTMLElement | null>;
    anchor?: RefObject<HTMLElement | null>;
    onEscape?: () => void;
    onOutsidePress?: () => void;
    inertBackground?: boolean;
}
export interface LayerHandle {
    /** A modal opened above this layer is still open. */
    covered: boolean;
    /** Whether this is the topmost layer, tooltips aside. For event handlers, not render. */
    isTop: () => boolean;
    /** The next close leaves focus where it is. */
    skipFocusRestore: () => void;
    markPressInside: () => void;
}
/** Registers an overlay with the layer stack of its presentation instance while `open`. */
export declare function useLayer({ open, kind, content, anchor, onEscape, onOutsidePress, inertBackground, }: LayerOptions): LayerHandle;
