import type React from "react";
import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";

interface CheckboxProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange" | "checked"
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

/** Square toggle for a single boolean, with the label as its own hit area. */
const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  disabled = false,
  children,
  className = "",
  ...props
}) => (
  <label
    className={cn(
      "group flex w-fit items-center gap-2",
      disabled ? "cursor-not-allowed" : "cursor-pointer",
      className,
    )}
  >
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="peer sr-only"
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          "h-4 w-4 rounded-[4px] border bg-btn-secondary",
          disabled
            ? "border-muted"
            : "border-secondary group-hover:bg-btn-secondary-hovered group-active:bg-btn-secondary-pressed",
        )}
      />
      {checked ? (
        <Icon
          iconName={IconName.Check}
          size={20}
          aria-hidden="true"
          color={disabled ? "var(--color-fill-basic-muted)" : "var(--color-fill-basic-primary)"}
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        />
      ) : null}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-[8px] border-2 border-[var(--color-border-focus-outline)] opacity-0 peer-focus-visible:opacity-100"
      />
    </span>
    {children ? (
      <span className={cn("label-small", disabled ? "text-basic-muted" : "text-basic-primary")}>
        {children}
      </span>
    ) : null}
  </label>
);

export default Checkbox;
