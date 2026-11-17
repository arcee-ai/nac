import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

/**
 * One row of a small popover menu. `checked` renders a radio-style mark for
 * exclusive choices (organize mode, behavior, project).
 */
export function MenuItem({
  icon,
  label,
  ariaLabel,
  hint,
  onSelect,
  destructive = false,
  checked,
  disabled = false,
  trailing,
}: {
  icon?: IconName;
  label: ReactNode;
  /** Accessible name when the visible label needs its subject ("Rename <title>"). */
  ariaLabel?: string;
  /** Muted second line. */
  hint?: ReactNode;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
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
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left outline-none",
        // Phones and coarse pointers (tablets) get 44px rows.
        hint ? "py-1.5" : "min-h-8 max-md:min-h-11 [@media(pointer:coarse)]:min-h-11",
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

const ITEMS = '[role^="menuitem"]:not(:disabled)';

/** Up/Down/Home/End move between a menu's enabled items; other keys are left alone. */
function roveItems(event: KeyboardEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement;
  if (!target.matches('[role^="menuitem"]')) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEMS));
  const index = items.indexOf(target);
  const next =
    event.key === "ArrowDown"
      ? items[(index + 1) % items.length]
      : event.key === "ArrowUp"
        ? items[(index - 1 + items.length) % items.length]
        : event.key === "Home"
          ? items[0]
          : event.key === "End"
            ? items.at(-1)
            : undefined;
  if (!next) return;
  event.preventDefault();
  next.focus({ preventScroll: true });
}

/**
 * The panel body of a popover menu. `autoFocus` moves focus to the first item
 * when the menu mounts, for menus opened from a button (the ARIA menu-button
 * pattern); the arrow keys always move between items.
 */
export function Menu({
  label,
  autoFocus = false,
  children,
}: {
  label: string;
  autoFocus?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (autoFocus) ref.current?.querySelector<HTMLElement>(ITEMS)?.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="flex flex-col gap-0.5"
      onKeyDown={roveItems}
    >
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
