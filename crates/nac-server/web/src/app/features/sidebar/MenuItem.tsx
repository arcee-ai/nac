import type { ReactNode } from "react";

import { Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

/**
 * One row of a small popover menu. `checked` renders a radio-style mark for
 * exclusive choices (organize mode, behavior, project).
 */
export function MenuItem({
  icon,
  label,
  hint,
  onSelect,
  destructive = false,
  checked,
  disabled = false,
  trailing,
}: {
  icon?: IconName;
  label: ReactNode;
  /** Muted second line. */
  hint?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  checked?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left outline-none",
        hint ? "py-1.5" : "min-h-8 max-md:min-h-11",
        "hover:bg-[var(--f-wash-1)] focus-visible:bg-[var(--f-wash-1)] disabled:opacity-50",
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
        destructive ? "text-error-primary" : "text-basic-primary",
      )}
    >
      {icon ? (
        <Icon
          iconName={icon}
          size={16}
          className={cn("shrink-0", destructive ? "text-error-primary" : "text-basic-tertiary")}
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-label truncate">{label}</span>
        {hint ? <span className="type-meta truncate text-basic-tertiary">{hint}</span> : null}
      </span>
      {trailing}
      {checked ? (
        <Icon iconName={IconName.Check} size={14} className="shrink-0 text-basic-primary" />
      ) : null}
    </button>
  );
}

/** The panel body of a popover menu. */
export function Menu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="menu" aria-label={label} className="flex flex-col gap-0.5">
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="mx-1 my-1 h-px bg-[var(--f-line-soft)]" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="type-meta px-2.5 pt-1.5 pb-1 text-basic-tertiary">{children}</p>;
}
