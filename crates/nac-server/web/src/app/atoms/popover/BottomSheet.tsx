import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import CoverBackground from "../cover-background";

/** Kept in step with the transition below, so the sheet is torn down after it. */
const EXIT_MS = 300;

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  zIndex?: number;
  className?: string;
  children?: React.ReactNode;
}

/**
 * The mobile face of a popover: a sheet that slides up from the bottom edge
 * instead of a panel floating next to a trigger that is barely on screen.
 */
const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onClose,
  zIndex = 120,
  className = "",
  children,
}) => {
  const [mounted, setMounted] = useState(open);
  const [down, setDown] = useState(true);
  const [wasOpen, setWasOpen] = useState(open);

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

  if (!mounted) return null;

  return createPortal(
    <>
      <CoverBackground open={!down} zIndex={zIndex} onClick={onClose} />
      <div
        style={{ zIndex }}
        className={cn(
          "fixed inset-x-0 bottom-0 flex flex-col min-h-[120px] max-h-[75dvh] overflow-y-auto",
          "rounded-t-[24px] py-4 bg-elevation-level-2 shadow-2xl",
          "transition-transform duration-300 ease-in-out [&>*]:shrink-0",
          down ? "translate-y-full" : "translate-y-0",
          className,
        )}
      >
        {children}
      </div>
    </>,
    document.body,
  );
};

export default BottomSheet;
