import React, { useMemo, useState } from "react";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { ANCHOR_GAP, AnchorPlacement, anchorSides, clippingAncestors } from "../../lib/anchor";
import { cn } from "../../lib/cn";
import { PopoverAnchor, PopoverContent, Popover as UIPopover } from "../../ui/popover";
import BottomSheet from "./BottomSheet";
import { PopoverFocusScope } from "./FocusScope";

export { AnchorPlacement as PopoverPlacement };

export enum PopoverSize {
  Small = "w-[240px]",
  Medium = "w-[320px]",
  Large = "w-[400px]",
  /** As wide as the content. */
  Fit = "w-max",
  /** At least as wide as the trigger, and wider when the content asks for it. */
  TriggerWidth = "min-w-[var(--radix-popover-trigger-width)]",
}

const PANEL_BASE =
  "flex flex-col gap-1 p-2 rounded-[12px] bg-elevation-level-3 shadow-2xl fade motion-reduce:!animate-none [&>*]:shrink-0";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** The panel body. Rendered into a bottom sheet on narrow screens. */
  content: React.ReactNode;
  /** The trigger the panel is anchored to. */
  children: React.ReactNode;
  placement?: AnchorPlacement;
  size?: PopoverSize | string;
  /**
   * Portal the panel to the presentation's overlay layer, so an ancestor with
   * clipped overflow cannot cut it off.
   */
  sticky?: boolean;
  closeOnOutsideClick?: boolean;
  closeOnEscape?: boolean;
  /** Below the mobile breakpoint, swap the panel for a bottom sheet. */
  sheetOnMobile?: boolean;
  className?: string;
  panelClassName?: string;
  sheetClassName?: string;
  /** Opt into a labelled dialog that focuses actions, traps Tab and restores focus. */
  focusScope?: string;
}

/**
 * Anchored panel with a trigger. Open state is owned by the caller, because
 * every use here also has to close it after acting on a row.
 */
const Popover: React.FC<PopoverProps> & {
  Placement: typeof AnchorPlacement;
  Size: typeof PopoverSize;
} = ({
  open,
  onClose,
  content,
  children,
  placement = AnchorPlacement.BottomRight,
  size = PopoverSize.Medium,
  sticky = false,
  closeOnOutsideClick = true,
  closeOnEscape = true,
  sheetOnMobile = true,
  className = "",
  panelClassName = "",
  sheetClassName = "",
  focusScope,
}) => {
  const asSheet = useIsMobile() && sheetOnMobile;
  const panelOpen = open && !asSheet;
  const body = focusScope ? (
    <PopoverFocusScope open={open} label={focusScope} onClose={closeOnEscape ? onClose : undefined}>
      {content}
    </PopoverFocusScope>
  ) : (
    content
  );
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  // Read once per opening: walking the cascade is the expensive part, and the
  // positioning reads the live rects of these elements on every update.
  const boundary = useMemo(
    () => (panelOpen && sticky && anchor ? clippingAncestors(anchor) : []),
    [panelOpen, sticky, anchor],
  );
  const { side, align } = anchorSides[placement];

  return (
    <UIPopover
      open={panelOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      closeOnEscape={closeOnEscape}
      closeOnOutsidePress={closeOnOutsideClick}
    >
      <PopoverAnchor ref={setAnchor} className={cn("relative w-fit h-fit leading-[0]", className)}>
        {children}
        {asSheet ? (
          <BottomSheet open={open} onClose={onClose} className={sheetClassName}>
            {body}
          </BottomSheet>
        ) : null}
        {/* Mounted in the same commit as `open`, so an owner's effect on `open`
            can already focus a field inside the panel. */}
        {panelOpen ? (
          <PopoverContent
            forceMount
            portal={sticky}
            side={side}
            align={align}
            sideOffset={ANCHOR_GAP}
            collisionPadding={ANCHOR_GAP}
            // The trigger's own box — a dialog that scrolls its body, a card that
            // hides its overflow — is where a portalled panel is expected to
            // appear, so it stays inside it whenever it fits there.
            collisionBoundary={sticky ? boundary : undefined}
            // The trigger keeps the focus: a panel opening under a field must not
            // take the caret out of it.
            onOpenAutoFocus={(event) => event.preventDefault()}
            className={cn(
              PANEL_BASE,
              // Panels take their text colour from where they open.
              "text-inherit",
              size,
              sticky ? "z-[120]" : "z-30",
              panelClassName,
            )}
          >
            {body}
          </PopoverContent>
        ) : null}
      </PopoverAnchor>
    </UIPopover>
  );
};

Popover.Placement = AnchorPlacement;
Popover.Size = PopoverSize;

export default Popover;
