import { React, html } from "../lib/html.js";
import { cn } from "../lib/cn.js";

const { useState, useRef, useCallback, useLayoutEffect } = React;
const createPortal = window.ReactDOM.createPortal;

export const TooltipPosition = {
  TopLeft: "top-left",
  TopCenter: "top-center",
  TopRight: "top-right",
  CenterRight: "center-right",
  BottomRight: "bottom-right",
  BottomCenter: "bottom-center",
  BottomLeft: "bottom-left",
  CenterLeft: "center-left",
};

const positionClasses = {
  "top-right": "top-[-8px] left-0 -translate-y-full",
  "top-center": "top-[-8px] left-1/2 -translate-y-full -translate-x-1/2",
  "top-left": "top-[-8px] right-0 -translate-y-full",
  "center-left": "top-1/2 right-[calc(100%+8px)] -translate-y-1/2",
  "bottom-left": "bottom-[-8px] right-0 translate-y-full",
  "bottom-center": "bottom-[-8px] left-1/2 translate-y-full -translate-x-1/2",
  "bottom-right": "bottom-[-8px] left-0 translate-y-full",
  "center-right": "top-1/2 left-[calc(100%+8px)] -translate-y-1/2",
};

// Same placements expressed as anchors, for the sticky variant which computes
// viewport coordinates instead of relying on an offset parent.
const stickyAnchors = {
  "top-right": { x: "start", y: "above" },
  "top-center": { x: "center", y: "above" },
  "top-left": { x: "end", y: "above" },
  "bottom-right": { x: "start", y: "below" },
  "bottom-center": { x: "center", y: "below" },
  "bottom-left": { x: "end", y: "below" },
  "center-left": { x: "before", y: "middle" },
  "center-right": { x: "after", y: "middle" },
};

const GAP = 8;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Keeps the box inside the viewport, which the CSS-only variant cannot do.
function stickyCoords(position, trigger, box) {
  const anchor = stickyAnchors[position] || stickyAnchors["top-center"];
  const left = {
    start: trigger.left,
    center: trigger.left + (trigger.width - box.width) / 2,
    end: trigger.right - box.width,
    before: trigger.left - GAP - box.width,
    after: trigger.right + GAP,
  }[anchor.x];
  const top = {
    above: trigger.top - GAP - box.height,
    below: trigger.bottom + GAP,
    middle: trigger.top + (trigger.height - box.height) / 2,
  }[anchor.y];
  return {
    left: clamp(left, GAP, Math.max(GAP, window.innerWidth - box.width - GAP)),
    top: clamp(top, GAP, Math.max(GAP, window.innerHeight - box.height - GAP)),
  };
}

const BOX_BASE =
  "tooltip-box text-left w-max h-fit max-w-[240px] flex-col gap-1 shadow-xl bg-elevation-ground-inverse p-2 rounded-[4px] fade";

function TooltipBox({ boxRef, title, description, keyboardShortcuts = [], className, style }) {
  return html`<div ref=${boxRef} class=${className} style=${style}>
    <div class="flex gap-2 items-center">
      <div class="label-micro text-basic-primary-inverse flex-grow">${title}</div>
      ${keyboardShortcuts.length > 0
        ? html`<div class="flex gap-1">
            ${keyboardShortcuts.map(
              (k, i) => html`<kbd
                key=${i}
                class="tag-label px-1 rounded-[3px] bg-sublevel-variant-A text-basic-secondary-inverse"
                >${k}</kbd
              >`,
            )}
          </div>`
        : null}
    </div>
    ${description
      ? html`<div class="text-micro text-basic-secondary-inverse w-fit h-fit">${description}</div>`
      : null}
  </div>`;
}

// Portalled variant: the box lives on `document.body`, so an ancestor with
// `overflow: hidden` (session cards) or a scroll container cannot clip it.
// Coordinates are measured from the trigger on hover, hence the two-pass render
// — the box is laid out invisibly first so its size is known.
function StickyTooltip({
  title,
  description,
  keyboardShortcuts,
  position,
  className,
  boxClassName,
  children,
  rest,
}) {
  const [trigger, setTrigger] = useState(null);
  const [coords, setCoords] = useState(null);
  const anchorRef = useRef(null);
  const boxRef = useRef(null);

  const show = useCallback(() => {
    const anchor = anchorRef.current;
    if (anchor) setTrigger(anchor.getBoundingClientRect());
  }, []);
  const hide = useCallback(() => {
    setTrigger(null);
    setCoords(null);
  }, []);

  useLayoutEffect(() => {
    if (!trigger) return undefined;
    const box = boxRef.current;
    if (box) setCoords(stickyCoords(position, trigger, box.getBoundingClientRect()));
    // Fixed coordinates go stale once anything moves underneath.
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [trigger, position, hide]);

  return html`<div
    ref=${anchorRef}
    class=${cn("w-fit h-fit", className)}
    onMouseEnter=${show}
    onMouseLeave=${hide}
    onFocusCapture=${show}
    onBlurCapture=${hide}
    ...${rest}
  >
    ${children}
    ${trigger
      ? createPortal(
          html`<${TooltipBox}
            boxRef=${boxRef}
            title=${title}
            description=${description}
            keyboardShortcuts=${keyboardShortcuts}
            className=${cn(
              BOX_BASE,
              "fixed flex z-[200] pointer-events-none",
              coords ? null : "invisible",
              boxClassName,
            )}
            style=${{ left: `${coords ? coords.left : 0}px`, top: `${coords ? coords.top : 0}px` }}
          />`,
          document.body,
        )
      : null}
  </div>`;
}

// CSS-hover tooltip (desktop). Pass `sticky` when an ancestor clips overflow.
export function Tooltip({
  title = "",
  description,
  keyboardShortcuts = [],
  position = TooltipPosition.TopCenter,
  className = "",
  boxClassName = "",
  disabled = false,
  sticky = false,
  children,
  ...rest
}) {
  if (disabled) return html`<div class=${cn("w-fit h-fit", className)}>${children}</div>`;
  if (sticky) {
    return html`<${StickyTooltip}
      title=${title}
      description=${description}
      keyboardShortcuts=${keyboardShortcuts}
      position=${position}
      className=${className}
      boxClassName=${boxClassName}
      rest=${rest}
    >
      ${children}
    </${StickyTooltip}>`;
  }
  return html`
    <div class=${cn("relative w-fit h-fit group", className)} ...${rest}>
      ${children}
      <${TooltipBox}
        title=${title}
        description=${description}
        keyboardShortcuts=${keyboardShortcuts}
        className=${cn(
          BOX_BASE,
          "absolute hidden group-hover:flex z-10",
          positionClasses[position],
          boxClassName,
        )}
      />
    </div>
  `;
}
