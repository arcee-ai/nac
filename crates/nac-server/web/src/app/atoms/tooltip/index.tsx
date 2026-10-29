import React, { useRef, useState } from "react";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { ANCHOR_GAP, AnchorPlacement, anchorSides } from "../../lib/anchor";
import { cn } from "../../lib/cn";
import { TooltipContent, TooltipTrigger, Tooltip as UITooltip } from "../../ui/tooltip";
import Icon, { IconName } from "../icon";
import KeyboardShortcut from "../keyboard-shortcut";
import Popover from "../popover";

export { AnchorPlacement as TooltipPosition };
type TooltipPosition = AnchorPlacement;

const BOX_BASE =
  "tooltip-box text-left w-max h-fit max-w-[240px] flex flex-col gap-1 shadow-xl bg-elevation-ground-inverse p-2 rounded-[4px] fade motion-reduce:!animate-none";

interface TooltipTextProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  keyboardShortcuts?: string[];
  /** Mobile sheet uses the regular (non-inverse) surface tokens. */
  inverted?: boolean;
  isMobile?: boolean;
}

const TooltipText: React.FC<TooltipTextProps> = ({
  title,
  description,
  keyboardShortcuts = [],
  inverted = true,
  isMobile = false,
}) => (
  <>
    <div className="flex gap-2 items-center">
      <div
        className={cn(
          isMobile ? "label-medium" : "label-micro",
          "flex-grow",
          inverted ? "text-primary-inverse" : "text-basic-primary",
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
          inverted ? "text-micro text-secondary-inverse" : "text-medium text-basic-secondary",
        )}
      >
        {description}
      </div>
    ) : null}
  </>
);

interface MobileTooltipProps extends TooltipTextProps {
  className?: string;
  children?: React.ReactNode;
}

/**
 * Hover tips are useless without a pointer, so on a phone a tap opens the
 * same content as a bottom sheet.
 */
const MobileTooltip: React.FC<MobileTooltipProps> = ({
  title,
  description,
  keyboardShortcuts,
  className,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const justOpenedRef = useRef(false);

  const handleToggle = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (e.type === "touchend") e.preventDefault();
    justOpenedRef.current = true;
    setOpen((prev) => !prev);
    setTimeout(() => {
      justOpenedRef.current = false;
    }, 100);
  };

  const handleClose = () => {
    // Ignore the synthetic click that follows touchend right after open.
    if (justOpenedRef.current) return;
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onClose={handleClose}
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
            <div className="flex flex-col gap-2">
              <TooltipText
                title={title}
                description={description}
                keyboardShortcuts={keyboardShortcuts}
                inverted={false}
                isMobile
              />
            </div>
          </div>
        </div>
      }
    >
      <div onClick={handleToggle} onTouchEnd={handleToggle} className="inline-block">
        {children}
      </div>
    </Popover>
  );
};

interface TooltipProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  keyboardShortcuts?: string[];
  position?: TooltipPosition;
  className?: string;
  boxClassName?: string;
  /** Keep the trigger mounted, but do not draw the tip. */
  disabled?: boolean;
  /**
   * Lay the trigger out without a positioning context of its own. The box is
   * portalled either way, so no ancestor that clips overflow can cut it off.
   */
  sticky?: boolean;
  /**
   * On a phone, tap opens the tip as a bottom sheet (via Popover). Only
   * meaningful together with `sticky`.
   */
  showTooltipOnMobile?: boolean;
  children?: React.ReactNode;
}

/**
 * A hint shown while the trigger is hovered or holds keyboard focus. Escape
 * dismisses it before anything beneath it, and a press on the trigger hides
 * it until the pointer comes back.
 */
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
  const [open, setOpen] = useState(false);
  const available = !disabled && !isMobile;

  // A tip already on screen has to leave when it becomes disabled, without
  // unmounting the trigger — that would reset whatever the tip wraps.
  if (open && !available) setOpen(false);

  if (sticky && showTooltipOnMobile && isMobile) {
    return (
      <MobileTooltip
        title={title}
        description={description}
        keyboardShortcuts={keyboardShortcuts}
        className={className}
      >
        {children}
      </MobileTooltip>
    );
  }

  const { side, align } = anchorSides[position];
  return (
    <UITooltip
      open={open}
      onOpenChange={(next) => setOpen(next && available)}
      disableHoverableContent
    >
      <TooltipTrigger asChild>
        <div
          className={cn(
            sticky ? "w-fit h-fit leading-[0]" : "relative w-fit h-fit leading-[0] group",
            className,
          )}
          onMouseEnter={() => setOpen(available)}
          onMouseLeave={() => setOpen(false)}
          onFocus={(event) => {
            // Focus a closing dialog hands back after a click is no reason to
            // show the hint; focus that arrived from the keyboard is.
            const target = event.target;
            if (target === document.activeElement && !target.matches(":focus-visible")) {
              event.preventDefault();
            }
          }}
        >
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={ANCHOR_GAP}
        collisionPadding={ANCHOR_GAP}
        className={cn(BOX_BASE, "pointer-events-none", boxClassName)}
      >
        <TooltipText
          title={title}
          description={description}
          keyboardShortcuts={keyboardShortcuts}
        />
      </TooltipContent>
    </UITooltip>
  );
};

Tooltip.Position = AnchorPlacement;

export default Tooltip;
