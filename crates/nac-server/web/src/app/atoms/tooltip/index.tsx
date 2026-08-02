import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnchorPlacement, anchorClasses, anchorCoords } from "../../lib/anchor";
import { cn } from "../../lib/cn";

export { AnchorPlacement as TooltipPosition };
type TooltipPosition = AnchorPlacement;

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
      setCoords(anchorCoords(position, trigger, box.getBoundingClientRect()));
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

const Tooltip: React.FC<TooltipProps> & { Position: typeof AnchorPlacement } = ({
  title = "",
  description,
  keyboardShortcuts = [],
  position = AnchorPlacement.TopCenter,
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
          anchorClasses[position],
          boxClassName,
        )}
      />
    </div>
  );
};

Tooltip.Position = AnchorPlacement;

export default Tooltip;
