/**
 * Placement of a floating box relative to its trigger, shared by the tooltip
 * and the popover. The first word is the side the box sits on, the second is
 * the direction it grows in: `BottomRight` hangs below the trigger with their
 * left edges aligned. `RightTop` sits to the right with the top edges aligned.
 */
export declare enum AnchorPlacement {
    TopLeft = "top-left",
    TopCenter = "top-center",
    TopRight = "top-right",
    CenterRight = "center-right",
    RightTop = "right-top",
    BottomRight = "bottom-right",
    BottomCenter = "bottom-center",
    BottomLeft = "bottom-left",
    CenterLeft = "center-left"
}
/** Offset between the trigger and the box, in pixels. */
export declare const ANCHOR_GAP = 8;
/** For a box positioned `absolute` inside a `relative` trigger wrapper. */
export declare const anchorClasses: {
    "top-right": string;
    "top-center": string;
    "top-left": string;
    "center-left": string;
    "bottom-left": string;
    "bottom-center": string;
    "bottom-right": string;
    "center-right": string;
    "right-top": string;
};
/** Region a floating box is kept inside, in viewport coordinates. */
export interface AnchorBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}
/**
 * The ancestors that clip an element, nearest first. Collected once per opening
 * because reading the cascade is the expensive half of `visibleBounds`, while
 * the rects it needs go stale on every scroll.
 */
export declare function clippingAncestors(element: Element | null): HTMLElement[];
/**
 * The region those ancestors leave visible, or null when nothing clips. A
 * portalled box escapes their clipping, but it still belongs inside the box its
 * trigger lives in rather than over that box's chrome — or, worse, over nothing
 * at all.
 */
export declare function visibleBounds(clippers: HTMLElement[]): AnchorBounds | null;
/**
 * Viewport coordinates for a portalled box, kept inside the window — which the
 * CSS-only variant cannot do — and inside `within` when one is given.
 */
export declare function anchorCoords(placement: AnchorPlacement, trigger: DOMRect, box: DOMRect, within?: AnchorBounds | null): {
    left: number;
    top: number;
};
