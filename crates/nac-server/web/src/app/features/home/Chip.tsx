import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

/**
 * A composer chip: a quiet pill that names one choice and opens its picker.
 * 32px on desktop, 44px on phones.
 */
export const Chip = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button"> & {
    icon?: IconName;
    leading?: ReactNode;
    /** Draws the trailing disclosure chevron. */
    menu?: boolean;
    pressed?: boolean;
  }
>(function Chip({ icon, leading, menu = true, pressed, className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      className={cn(
        "type-label inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-pill px-3 max-md:h-11 max-md:px-3.5",
        "border border-transparent text-basic-secondary outline-none",
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
        "hover:bg-[var(--f-wash-1)] hover:text-basic-primary",
        "focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
        "disabled:pointer-events-none disabled:opacity-50",
        pressed && "border-tertiary bg-[var(--f-wash-1)] text-basic-primary",
        className,
      )}
      {...props}
    >
      {leading}
      {icon ? <Icon iconName={icon} size={14} className="shrink-0 text-basic-tertiary" /> : null}
      <span className="min-w-0 truncate">{children}</span>
      {menu ? (
        <Icon iconName={IconName.Down} size={12} className="shrink-0 text-basic-muted" />
      ) : null}
    </button>
  );
});
