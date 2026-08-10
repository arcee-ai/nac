/**
 * Placement of a floating box relative to its trigger, shared by the tooltip
 * and the popover. The first word is the side the box sits on, the second is
 * the direction it grows in: `BottomRight` hangs below the trigger with their
 * left edges aligned.
 */
export enum AnchorPlacement {
  TopLeft = "top-left",
  TopCenter = "top-center",
  TopRight = "top-right",
  CenterRight = "center-right",
  BottomRight = "bottom-right",
  BottomCenter = "bottom-center",
  BottomLeft = "bottom-left",
  CenterLeft = "center-left",
}

/** Offset between the trigger and the box, in pixels. */
export const ANCHOR_GAP = 8;

/** For a box positioned `absolute` inside a `relative` trigger wrapper. */
export const anchorClasses: Record<AnchorPlacement, string> = {
  [AnchorPlacement.TopRight]: "top-[-8px] left-0 -translate-y-full",
  [AnchorPlacement.TopCenter]:
    "top-[-8px] left-1/2 -translate-y-full -translate-x-1/2",
  [AnchorPlacement.TopLeft]: "top-[-8px] right-0 -translate-y-full",
  [AnchorPlacement.CenterLeft]:
    "top-1/2 right-[calc(100%+8px)] -translate-y-1/2",
  [AnchorPlacement.BottomLeft]: "bottom-[-8px] right-0 translate-y-full",
  [AnchorPlacement.BottomCenter]:
    "bottom-[-8px] left-1/2 translate-y-full -translate-x-1/2",
  [AnchorPlacement.BottomRight]: "bottom-[-8px] left-0 translate-y-full",
  [AnchorPlacement.CenterRight]:
    "top-1/2 left-[calc(100%+8px)] -translate-y-1/2",
};

type HorizontalAnchor = "start" | "center" | "end" | "before" | "after";
type VerticalAnchor = "above" | "below" | "middle";

// The same placements expressed as anchors, for boxes that compute viewport
// coordinates instead of relying on an offset parent.
const anchors: Record<
  AnchorPlacement,
  { x: HorizontalAnchor; y: VerticalAnchor }
> = {
  [AnchorPlacement.TopRight]: { x: "start", y: "above" },
  [AnchorPlacement.TopCenter]: { x: "center", y: "above" },
  [AnchorPlacement.TopLeft]: { x: "end", y: "above" },
  [AnchorPlacement.BottomRight]: { x: "start", y: "below" },
  [AnchorPlacement.BottomCenter]: { x: "center", y: "below" },
  [AnchorPlacement.BottomLeft]: { x: "end", y: "below" },
  [AnchorPlacement.CenterLeft]: { x: "before", y: "middle" },
  [AnchorPlacement.CenterRight]: { x: "after", y: "middle" },
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Viewport coordinates for a portalled box, kept inside the window — which the
 * CSS-only variant cannot do.
 */
export function anchorCoords(
  placement: AnchorPlacement,
  trigger: DOMRect,
  box: DOMRect,
): { left: number; top: number } {
  const anchor = anchors[placement] ?? anchors[AnchorPlacement.TopCenter];
  const left = {
    start: trigger.left,
    center: trigger.left + (trigger.width - box.width) / 2,
    end: trigger.right - box.width,
    before: trigger.left - ANCHOR_GAP - box.width,
    after: trigger.right + ANCHOR_GAP,
  }[anchor.x];
  const top = {
    above: trigger.top - ANCHOR_GAP - box.height,
    below: trigger.bottom + ANCHOR_GAP,
    middle: trigger.top + (trigger.height - box.height) / 2,
  }[anchor.y];
  return {
    left: clamp(
      left,
      ANCHOR_GAP,
      Math.max(ANCHOR_GAP, window.innerWidth - box.width - ANCHOR_GAP),
    ),
    top: clamp(
      top,
      ANCHOR_GAP,
      Math.max(ANCHOR_GAP, window.innerHeight - box.height - ANCHOR_GAP),
    ),
  };
}
