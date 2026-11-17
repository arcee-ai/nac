import { memo } from "react";

import { Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

/**
 * A small round button floating just above the composer that brings the
 * newest message back into view. Always mounted, so showing and hiding can
 * fade and lift instead of blinking in and out.
 */
export const JumpToLatest = memo(function JumpToLatest({
  visible,
  onJump,
}: {
  visible: boolean;
  onJump: () => void;
}) {
  return (
    <div
      className={cn(
        "absolute left-1/2 z-[2] -translate-x-1/2 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
        "bottom-[calc(var(--composer-height,0px)_+_12px)]",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      <button
        type="button"
        aria-label="Last messages"
        title="Last messages"
        tabIndex={visible ? undefined : -1}
        onClick={onJump}
        className={cn(
          "flex size-8 items-center justify-center rounded-pill border border-tertiary bg-elevation-level-3 text-basic-secondary shadow-md",
          "transition-colors duration-150 ease-out hover:text-basic-primary max-md:size-11",
          "outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus-outline)]",
        )}
      >
        <Icon iconName={IconName.ArrowDown} size={16} aria-hidden className="!text-current" />
      </button>
    </div>
  );
});
