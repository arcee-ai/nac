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
export const anchorClasses = {
  [AnchorPlacement.TopRight]: "top-[-8px] left-0 -translate-y-full",
  [AnchorPlacement.TopCenter]: "top-[-8px] left-1/2 -translate-y-full -translate-x-1/2",
  [AnchorPlacement.TopLeft]: "top-[-8px] right-0 -translate-y-full",
  [AnchorPlacement.CenterLeft]: "top-1/2 right-[calc(100%+8px)] -translate-y-1/2",
  [AnchorPlacement.BottomLeft]: "bottom-[-8px] right-0 translate-y-full",
  [AnchorPlacement.BottomCenter]: "bottom-[-8px] left-1/2 translate-y-full -translate-x-1/2",
  [AnchorPlacement.BottomRight]: "bottom-[-8px] left-0 translate-y-full",
  [AnchorPlacement.CenterRight]: "top-1/2 left-[calc(100%+8px)] -translate-y-1/2",
} satisfies Record<AnchorPlacement, string>;

type HorizontalAnchor = "start" | "center" | "end" | "before" | "after";
type VerticalAnchor = "above" | "below" | "middle";

// The same placements expressed as anchors, for boxes that compute viewport
// coordinates instead of relying on an offset parent.
const anchors = {
  [AnchorPlacement.TopRight]: { x: "start", y: "above" },
  [AnchorPlacement.TopCenter]: { x: "center", y: "above" },
  [AnchorPlacement.TopLeft]: { x: "end", y: "above" },
  [AnchorPlacement.BottomRight]: { x: "start", y: "below" },
  [AnchorPlacement.BottomCenter]: { x: "center", y: "below" },
  [AnchorPlacement.BottomLeft]: { x: "end", y: "below" },
  [AnchorPlacement.CenterLeft]: { x: "before", y: "middle" },
  [AnchorPlacement.CenterRight]: { x: "after", y: "middle" },
} satisfies Record<AnchorPlacement, { x: HorizontalAnchor; y: VerticalAnchor }>;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Region a floating box is kept inside, in viewport coordinates. */
export interface AnchorBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Span {
  start: number;
  end: number;
}

/**
 * The ancestors that clip an element, nearest first. Collected once per opening
 * because reading the cascade is the expensive half of `visibleBounds`, while
 * the rects it needs go stale on every scroll.
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

/**
 * The region those ancestors leave visible, or null when nothing clips. A
 * portalled box escapes their clipping, but it still belongs inside the box its
 * trigger lives in rather than over that box's chrome — or, worse, over nothing
 * at all.
 */
export function visibleBounds(clippers: HTMLElement[]): AnchorBounds | null {
  let bounds: AnchorBounds | null = null;
  for (const node of clippers) {
    const rect = node.getBoundingClientRect();
    bounds = bounds
      ? {
          left: Math.max(bounds.left, rect.left),
          top: Math.max(bounds.top, rect.top),
          right: Math.min(bounds.right, rect.right),
          bottom: Math.min(bounds.bottom, rect.bottom),
        }
      : {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
  }
  return bounds;
}

/**
 * One coordinate, held inside `limit` and inside `preferred` as well whenever
 * the box has the room to fit there — a box too big for the region it was
 * anchored in is better off overhanging it than squeezed into it.
 */
function fit(start: number, size: number, limit: Span, preferred?: Span): number {
  const span =
    preferred && size + 2 * ANCHOR_GAP <= preferred.end - preferred.start ? preferred : limit;
  const min = span.start + ANCHOR_GAP;
  return clamp(start, min, Math.max(min, span.end - size - ANCHOR_GAP));
}

/**
 * Viewport coordinates for a portalled box, kept inside the window — which the
 * CSS-only variant cannot do — and inside `within` when one is given.
 */
export function anchorCoords(
  placement: AnchorPlacement,
  trigger: DOMRect,
  box: DOMRect,
  within?: AnchorBounds | null,
) {
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
    left: fit(
      left,
      box.width,
      { start: 0, end: window.innerWidth },
      within ? { start: within.left, end: within.right } : undefined,
    ),
    top: fit(
      top,
      box.height,
      { start: 0, end: window.innerHeight },
      within ? { start: within.top, end: within.bottom } : undefined,
    ),
  };
}
