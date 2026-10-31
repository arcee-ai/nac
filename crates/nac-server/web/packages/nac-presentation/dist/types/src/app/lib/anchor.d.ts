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
/** The same placements as the side and alignment Radix positions a box by. */
export declare const anchorSides: {
    "top-right": {
        side: "top";
        align: "start";
    };
    "top-center": {
        side: "top";
        align: "center";
    };
    "top-left": {
        side: "top";
        align: "end";
    };
    "center-left": {
        side: "left";
        align: "center";
    };
    "bottom-left": {
        side: "bottom";
        align: "end";
    };
    "bottom-center": {
        side: "bottom";
        align: "center";
    };
    "bottom-right": {
        side: "bottom";
        align: "start";
    };
    "center-right": {
        side: "right";
        align: "center";
    };
    "right-top": {
        side: "right";
        align: "start";
    };
};
/**
 * The ancestors that clip an element, nearest first. A portalled box escapes
 * their clipping, but it still belongs inside the box its trigger lives in
 * rather than over that box's chrome — or, worse, over nothing at all.
 */
export declare function clippingAncestors(element: Element | null): HTMLElement[];
