import type React from "react";
import { cn } from "../../lib/cn";

interface RadioProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange" | "checked"
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

/**
 * One option out of a set. Give every radio in a group the same `name` so the
 * browser handles arrow-key navigation between them.
 */
const Radio: React.FC<RadioProps> = ({
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
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <input
        type="radio"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="peer sr-only"
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          "size-4 rounded-full border shadow-concave",
          disabled
            ? cn("bg-btn-secondary-disabled", checked ? "border-primary" : "border-muted")
            : "border-primary bg-btn-secondary group-hover:bg-btn-secondary-hovered group-active:bg-btn-secondary-pressed",
        )}
      />
      {checked ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-convex",
            disabled ? "radio-mark-disabled" : "radio-mark",
          )}
        />
      ) : null}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-border-focus-outline)] opacity-0 peer-focus-visible:opacity-100"
      />
    </span>
    {children ? (
      <span className={cn("label-small", disabled ? "text-basic-muted" : "text-basic-primary")}>
        {children}
      </span>
    ) : null}
  </label>
);

export default Radio;
