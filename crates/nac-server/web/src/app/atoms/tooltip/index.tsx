import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { AnchorPlacement, anchorClasses, anchorCoords } from "../../lib/anchor";
import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";
import KeyboardShortcut from "../keyboard-shortcut";
import Popover from "../popover";

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
  /** Mobile sheet uses the regular (non-inverse) surface tokens. */
  inverted?: boolean;
  isMobile?: boolean;
}

const TooltipBox: React.FC<TooltipBoxProps> = ({
  boxRef,
  title,
  description,
  keyboardShortcuts = [],
  className,
  style,
  inverted = true,
  isMobile = false,
}) => (
  <div ref={boxRef} className={className} style={style}>
    <div className="flex gap-2 items-center">
      <div
        className={cn(
          isMobile ? "label-medium" : "label-micro",
          "flex-grow",
          inverted ? "text-basic-primary-inverse" : "text-basic-primary",
        )}
      >
        {title}
      </div>
      {keyboardShortcuts.length > 0 ? (
        // Key names, not glyphs: the shortcut is declared once and drawn for the
        // platform it is read on.
        <KeyboardShortcut keys={keyboardShortcuts} inversed={inverted} />
      ) : null}
    </div>
    {description ? (
      <div
        className={cn(
          "w-fit h-fit",
          inverted ? "text-micro text-basic-secondary-inverse" : "text-medium text-basic-secondary",
        )}
      >
        {description}
      </div>
    ) : null}
  </div>
);

interface StickyTooltipProps extends TooltipBoxProps {
  position: TooltipPosition;
  boxClassName?: string;
  showOnMobile?: boolean;
  children?: React.ReactNode;
}

/**
 * Portalled variant: the box lives on `document.body`, so an ancestor with
 * `overflow: hidden` (session cards) or a scroll container cannot clip it.
 * Coordinates are measured from the trigger on hover, hence the two-pass render
 * — the box is laid out invisibly first so its size is known.
 *
 * On a phone (when `showOnMobile`), the same content opens as a bottom sheet
 * via Popover — hover tooltips are useless without a pointer.
 */
const StickyTooltip: React.FC<StickyTooltipProps> = ({
  title,
  description,
  keyboardShortcuts,
  position,
  className,
  boxClassName,
  showOnMobile = false,
  children,
}) => {
  const isMobile = useIsMobile();
  const [trigger, setTrigger] = useState<DOMRect | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [wasMobile, setWasMobile] = useState(isMobile);
  const justOpenedRef = useRef(false);

  // Growing past the breakpoint hands the hint back to hover, so the sheet
  // state left behind must not survive into the next narrow layout.
  if (wasMobile !== isMobile) {
    setWasMobile(isMobile);
    if (!isMobile) setMobileOpen(false);
  }
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
    if (!trigger || isMobile) return undefined;
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
  }, [trigger, position, hide, isMobile]);

  const handleMobileToggle = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (e.type === "touchend") e.preventDefault();
    justOpenedRef.current = true;
    setMobileOpen((prev) => !prev);
    setTimeout(() => {
      justOpenedRef.current = false;
    }, 100);
  };

  const handleCloseMobile = () => {
    // Ignore the synthetic click that follows touchend right after open.
    if (justOpenedRef.current) return;
    setMobileOpen(false);
  };

  if (showOnMobile && isMobile) {
    return (
      <Popover
        open={mobileOpen}
        onClose={handleCloseMobile}
        className={className}
        content={
          <div className="px-4 py-2 flex overflow-hidden gap-3">
            <Icon
              iconName={IconName.Info}
              size={24}
              className="w-6 min-w-6 max-w-6"
              color="var(--color-fill-basic-tertiary)"
            />
            <div className="flex flex-col gap-2 min-w-0">
              <TooltipBox
                title={title}
                description={description}
                keyboardShortcuts={keyboardShortcuts}
                inverted={false}
                className="flex flex-col gap-2"
                isMobile={isMobile}
              />
            </div>
          </div>
        }
      >
        <div
          ref={anchorRef}
          onClick={handleMobileToggle}
          onTouchEnd={handleMobileToggle}
          className="inline-block cursor-pointer"
        >
          {children}
        </div>
      </Popover>
    );
  }

  return (
    <div
      ref={anchorRef}
      className={cn("w-fit h-fit", className)}
      onMouseEnter={isMobile ? undefined : show}
      onMouseLeave={isMobile ? undefined : hide}
      onFocusCapture={isMobile ? undefined : show}
      onBlurCapture={isMobile ? undefined : hide}
    >
      {children}
      {!isMobile && trigger
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
              style={{
                left: `${coords?.left ?? 0}px`,
                top: `${coords?.top ?? 0}px`,
              }}
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
  /**
   * On a phone, tap opens the tip as a bottom sheet (via Popover). Only
   * meaningful together with `sticky`.
   */
  showTooltipOnMobile?: boolean;
  children?: React.ReactNode;
}

const Tooltip: React.FC<TooltipProps> & {
  Position: typeof AnchorPlacement;
} = ({
  title = "",
  description,
  keyboardShortcuts = [],
  position = AnchorPlacement.TopCenter,
  className = "",
  boxClassName = "",
  disabled = false,
  sticky = false,
  showTooltipOnMobile = false,
  children,
}) => {
  const isMobile = useIsMobile();

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
        showOnMobile={showTooltipOnMobile}
      >
        {children}
      </StickyTooltip>
    );
  }
  // Absolute (non-sticky) tips rely on hover; hide them on a phone.
  return (
    <div className={cn("relative w-fit h-fit group", className)}>
      {children}
      {!isMobile ? (
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
      ) : null}
    </div>
  );
};

Tooltip.Position = AnchorPlacement;

export default Tooltip;
