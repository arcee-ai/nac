import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";

export enum TooltipPosition {
  TopLeft = "top-left",
  TopCenter = "top-center",
  TopRight = "top-right",
  CenterRight = "center-right",
  BottomRight = "bottom-right",
  BottomCenter = "bottom-center",
  BottomLeft = "bottom-left",
  CenterLeft = "center-left",
}

const positionClasses: Record<TooltipPosition, string> = {
  [TooltipPosition.TopRight]: "top-[-8px] left-0 -translate-y-full",
  [TooltipPosition.TopCenter]:
    "top-[-8px] left-1/2 -translate-y-full -translate-x-1/2",
  [TooltipPosition.TopLeft]: "top-[-8px] right-0 -translate-y-full",
  [TooltipPosition.CenterLeft]:
    "top-1/2 right-[calc(100%+8px)] -translate-y-1/2",
  [TooltipPosition.BottomLeft]: "bottom-[-8px] right-0 translate-y-full",
  [TooltipPosition.BottomCenter]:
    "bottom-[-8px] left-1/2 translate-y-full -translate-x-1/2",
  [TooltipPosition.BottomRight]: "bottom-[-8px] left-0 translate-y-full",
  [TooltipPosition.CenterRight]:
    "top-1/2 left-[calc(100%+8px)] -translate-y-1/2",
};

type HorizontalAnchor = "start" | "center" | "end" | "before" | "after";
type VerticalAnchor = "above" | "below" | "middle";

// Same placements expressed as anchors, for the sticky variant which computes
// viewport coordinates instead of relying on an offset parent.
const stickyAnchors: Record<
  TooltipPosition,
  { x: HorizontalAnchor; y: VerticalAnchor }
> = {
  [TooltipPosition.TopRight]: { x: "start", y: "above" },
  [TooltipPosition.TopCenter]: { x: "center", y: "above" },
  [TooltipPosition.TopLeft]: { x: "end", y: "above" },
  [TooltipPosition.BottomRight]: { x: "start", y: "below" },
  [TooltipPosition.BottomCenter]: { x: "center", y: "below" },
  [TooltipPosition.BottomLeft]: { x: "end", y: "below" },
  [TooltipPosition.CenterLeft]: { x: "before", y: "middle" },
  [TooltipPosition.CenterRight]: { x: "after", y: "middle" },
};

const GAP = 8;
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

// Keeps the box inside the viewport, which the CSS-only variant cannot do.
function stickyCoords(
  position: TooltipPosition,
  trigger: DOMRect,
  box: DOMRect,
): { left: number; top: number } {
  const anchor = stickyAnchors[position] ?? stickyAnchors[
    TooltipPosition.TopCenter
  ];
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

interface TooltipBoxProps {
  boxRef?: React.Ref<HTMLDivElement>;
  title?: React.ReactNode;
  description?: React.ReactNode;
  keyboardShortcuts?: string[];
  className?: string;
  style?: React.CSSProperties;
}

const TooltipBox: React.FC<TooltipBoxProps> = ({
  boxRef,
  title,
  description,
  keyboardShortcuts = [],
  className,
  style,
}) => (
  <div ref={boxRef} className={className} style={style}>
    <div className="flex gap-2 items-center">
      <div className="label-micro text-basic-primary-inverse flex-grow">
        {title}
      </div>
      {keyboardShortcuts.length > 0 ? (
        <div className="flex gap-1">
          {keyboardShortcuts.map((key, i) => (
            <kbd
              key={i}
              className="tag-label px-1 rounded-[3px] bg-sublevel-variant-A text-basic-secondary-inverse"
            >
              {key}
            </kbd>
          ))}
        </div>
      ) : null}
    </div>
    {description ? (
      <div className="text-micro text-basic-secondary-inverse w-fit h-fit">
        {description}
      </div>
    ) : null}
  </div>
);

interface StickyTooltipProps extends TooltipBoxProps {
  position: TooltipPosition;
  boxClassName?: string;
  children?: React.ReactNode;
}

/**
 * Portalled variant: the box lives on `document.body`, so an ancestor with
 * `overflow: hidden` (session cards) or a scroll container cannot clip it.
 * Coordinates are measured from the trigger on hover, hence the two-pass render
 * — the box is laid out invisibly first so its size is known.
 */
const StickyTooltip: React.FC<StickyTooltipProps> = ({
  title,
  description,
  keyboardShortcuts,
  position,
  className,
  boxClassName,
  children,
}) => {
  const [trigger, setTrigger] = useState<DOMRect | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null,
  );
  const anchorRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

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
    if (box) {
      setCoords(stickyCoords(position, trigger, box.getBoundingClientRect()));
    }
    // Fixed coordinates go stale once anything moves underneath.
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [trigger, position, hide]);

  return (
    <div
      ref={anchorRef}
      className={cn("w-fit h-fit", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {trigger
        ? createPortal(
            <TooltipBox
              boxRef={boxRef}
              title={title}
              description={description}
              keyboardShortcuts={keyboardShortcuts}
              className={cn(
                BOX_BASE,
                "fixed flex z-[200] pointer-events-none",
                coords ? null : "invisible",
                boxClassName,
              )}
              style={{ left: `${coords?.left ?? 0}px`, top: `${coords?.top ?? 0}px` }}
            />,
            document.body,
          )
        : null}
    </div>
  );
};

interface TooltipProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  keyboardShortcuts?: string[];
  position?: TooltipPosition;
  className?: string;
  boxClassName?: string;
  disabled?: boolean;
  /** Portal the box to the body when an ancestor clips overflow. */
  sticky?: boolean;
  children?: React.ReactNode;
}

const Tooltip: React.FC<TooltipProps> & { Position: typeof TooltipPosition } = ({
  title = "",
  description,
  keyboardShortcuts = [],
  position = TooltipPosition.TopCenter,
  className = "",
  boxClassName = "",
  disabled = false,
  sticky = false,
  children,
}) => {
  if (disabled) {
    return <div className={cn("w-fit h-fit", className)}>{children}</div>;
  }
  if (sticky) {
    return (
      <StickyTooltip
        title={title}
        description={description}
        keyboardShortcuts={keyboardShortcuts}
        position={position}
        className={className}
        boxClassName={boxClassName}
      >
        {children}
      </StickyTooltip>
    );
  }
  return (
    <div className={cn("relative w-fit h-fit group", className)}>
      {children}
      <TooltipBox
        title={title}
        description={description}
        keyboardShortcuts={keyboardShortcuts}
        className={cn(
          BOX_BASE,
          "absolute hidden group-hover:flex z-10",
          positionClasses[position],
          boxClassName,
        )}
      />
    </div>
  );
};

Tooltip.Position = TooltipPosition;

export default Tooltip;
