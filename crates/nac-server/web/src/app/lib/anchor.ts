/**
 * Placement of a floating box relative to its trigger, shared by the tooltip
 * and the popover. The first word is the side the box sits on, the second is
 * the direction it grows in: `BottomRight` hangs below the trigger with their
 * left edges aligned. `RightTop` sits to the right with the top edges aligned.
 */
export enum AnchorPlacement {
  TopLeft = "top-left",
  TopCenter = "top-center",
  TopRight = "top-right",
  CenterRight = "center-right",
  RightTop = "right-top",
  BottomRight = "bottom-right",
  BottomCenter = "bottom-center",
  BottomLeft = "bottom-left",
  CenterLeft = "center-left",
}

/** Offset between the trigger and the box, in pixels. */
export const ANCHOR_GAP = 8;

type Side = "top" | "right" | "bottom" | "left";
type Align = "start" | "center" | "end";

/** The same placements as the side and alignment Radix positions a box by. */
export const anchorSides = {
  [AnchorPlacement.TopRight]: { side: "top", align: "start" },
  [AnchorPlacement.TopCenter]: { side: "top", align: "center" },
  [AnchorPlacement.TopLeft]: { side: "top", align: "end" },
  [AnchorPlacement.CenterLeft]: { side: "left", align: "center" },
  [AnchorPlacement.BottomLeft]: { side: "bottom", align: "end" },
  [AnchorPlacement.BottomCenter]: { side: "bottom", align: "center" },
  [AnchorPlacement.BottomRight]: { side: "bottom", align: "start" },
  [AnchorPlacement.CenterRight]: { side: "right", align: "center" },
  [AnchorPlacement.RightTop]: { side: "right", align: "start" },
} satisfies Record<AnchorPlacement, { side: Side; align: Align }>;

/**
 * The ancestors that clip an element, nearest first. A portalled box escapes
 * their clipping, but it still belongs inside the box its trigger lives in
 * rather than over that box's chrome — or, worse, over nothing at all.
 */
export function clippingAncestors(element: Element | null): HTMLElement[] {
  const clippers: HTMLElement[] = [];
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      clippers.push(node);
    }
  }
  return clippers;
}
