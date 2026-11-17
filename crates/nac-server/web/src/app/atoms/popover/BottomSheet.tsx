import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "../../lib/cn";
import { Sheet, SheetContent, SheetOverlay, SheetPortal } from "../../ui/sheet";
import CoverBackground from "../cover-background";

/** Kept in step with the transition below, so the sheet is torn down after it. */
const EXIT_MS = 200;

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  closeOnEscape?: boolean;
  zIndex?: number;
  className?: string;
  children?: React.ReactNode;
}

/**
 * The mobile face of a popover: a sheet that slides up from the bottom edge
 * instead of a panel floating next to a trigger that is barely on screen.
 * 20px top corners, a grab handle, and the home-indicator inset below.
 */
const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onClose,
  closeOnEscape = true,
  zIndex = 120,
  className = "",
  children,
}) => {
  const [mounted, setMounted] = useState(open);
  const [down, setDown] = useState(true);
  const [wasOpen, setWasOpen] = useState(open);
  const previousPathnameRef = useRef("");
  const location = useLocation();

  // Both edges start from the off-screen transform: opening mounts there and
  // slides up, closing drops back down and unmounts once the transition ends.
  if (wasOpen !== open) {
    setWasOpen(open);
    setDown(true);
    if (open) setMounted(true);
  }

  useEffect(() => {
    if (!open || !mounted) return undefined;
    // The closed transform has to be painted before it is flipped, otherwise
    // the sheet appears in place instead of sliding in.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setDown(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open, mounted]);

  useEffect(() => {
    if (open || !mounted) return undefined;
    const timer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  // Dismiss when the route changes — a sheet left open over a new page is
  // almost always a leftover from the previous screen.
  useEffect(() => {
    if (
      previousPathnameRef.current &&
      previousPathnameRef.current !== location.pathname &&
      mounted
    ) {
      onClose();
    }
    previousPathnameRef.current = location.pathname;
  }, [location.pathname, mounted, onClose]);

  if (!mounted) return null;

  return (
    <Sheet
      open={open}
      closeOnEscape={closeOnEscape}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetPortal forceMount>
        <SheetOverlay asChild>
          <CoverBackground open={!down} zIndex={zIndex} />
        </SheetOverlay>
        <SheetContent
          side="bottom"
          forceMount
          // A popover's panel in another form: a list to pick from, not a dialog.
          role={undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
          style={{ zIndex }}
          className={cn(
            "fixed inset-x-0 bottom-0 flex flex-col min-h-[120px] max-h-[min(75dvh,calc(100%-16px))] overflow-y-auto overscroll-contain",
            "rounded-t-sheet bg-elevation-level-2 pt-1 pb-[calc(12px+env(safe-area-inset-bottom))] shadow-2xl",
            "transition-transform duration-200 ease-[var(--ease-drawer)] motion-reduce:transition-none [&>*]:shrink-0",
            down ? "translate-y-full" : "translate-y-0",
            className,
          )}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div aria-hidden className="flex justify-center pt-1 pb-2">
            <span className="h-1 w-9 rounded-pill bg-[var(--f-wash-4)]" />
          </div>
          {children}
        </SheetContent>
      </SheetPortal>
    </Sheet>
  );
};

export default BottomSheet;
