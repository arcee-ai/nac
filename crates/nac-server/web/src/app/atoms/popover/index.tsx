import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "../../hooks/useMediaQuery";
import {
  AnchorPlacement,
  anchorClasses,
  anchorCoords,
  clippingAncestors,
  visibleBounds,
} from "../../lib/anchor";
import { cn } from "../../lib/cn";
import BottomSheet from "./BottomSheet";

export { AnchorPlacement as PopoverPlacement };

export enum PopoverSize {
  Medium = "w-[320px]",
  Fit = "w-max",
}

const PANEL_BASE =
  "flex flex-col gap-1 p-2 rounded-[8px] bg-elevation-level-3 shadow-2xl fade [&>*]:shrink-0";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  content: React.ReactNode;
  children: React.ReactNode;
  placement?: AnchorPlacement;
  size?: PopoverSize | string;
  /**
   * Portal the panel to the body and place it from measured coordinates, so an
   * ancestor with clipped overflow cannot cut it off.
   */
  sticky?: boolean;
  closeOnOutsideClick?: boolean;
  closeOnEscape?: boolean;
  sheetOnMobile?: boolean;
  className?: string;
  panelClassName?: string;
  sheetClassName?: string;
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
}) => {
  const asSheet = useIsMobile() && sheetOnMobile;
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null,
  );

  useEffect(() => {
    if (!open || !closeOnOutsideClick || asSheet) return undefined;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The panel is checked separately: when portalled it is not a descendant
      // of the trigger wrapper.
      if (containerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, closeOnOutsideClick, asSheet, onClose]);

  useEffect(() => {
    if (!open || !closeOnEscape) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeOnEscape, onClose]);

  // Runs before paint, so coordinates left over from the previous opening are
  // corrected before the panel is ever shown at them.
  useLayoutEffect(() => {
    if (!open || asSheet || !sticky) return undefined;
    const trigger = containerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return undefined;

    // The trigger's own box — a dialog that scrolls its body, a card that hides
    // its overflow — is where the panel is expected to appear, so it is kept
    // inside it even though the portal frees it from the clipping.
    const clippers = clippingAncestors(trigger);
    const place = () =>
      setCoords(
        anchorCoords(
          placement,
          trigger.getBoundingClientRect(),
          panel.getBoundingClientRect(),
          visibleBounds(clippers),
        ),
      );
    place();

    const observer = new ResizeObserver(place);
    observer.observe(panel);
    // Fixed coordinates go stale as soon as anything underneath moves.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, asSheet, sticky, placement]);

  const panel = (
    <div
      ref={panelRef}
      className={cn(
        PANEL_BASE,
        size,
        sticky
          ? cn("fixed z-[120]", coords ? null : "invisible")
          : cn("absolute z-30", anchorClasses[placement]),
        panelClassName,
      )}
      style={
        sticky ? { left: coords?.left ?? 0, top: coords?.top ?? 0 } : undefined
      }
    >
      {content}
    </div>
  );

  return (
    <div ref={containerRef} className={cn("relative w-fit h-fit", className)}>
      {children}
      {asSheet ? (
        <BottomSheet open={open} onClose={onClose} className={sheetClassName}>
          {content}
        </BottomSheet>
      ) : open ? (
        sticky ? (
          createPortal(panel, document.body)
        ) : (
          panel
        )
      ) : null}
    </div>
  );
};

Popover.Placement = AnchorPlacement;
Popover.Size = PopoverSize;

export default Popover;
