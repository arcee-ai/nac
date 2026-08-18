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
      "flex items-start gap-2 w-fit",
      disabled ? "cursor-not-allowed opacity-60" : "",
      className,
    )}
  >
    <input
      type="radio"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      disabled={disabled}
      className="sr-only peer"
      {...props}
    />
    <span
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center shrink-0 mt-[1px] w-4 h-4 rounded-full border transition-colors duration-150",
        "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent-primary",
        disabled
          ? "bg-btn-secondary-disabled border-muted"
          : "bg-btn-secondary border-secondary hover:bg-btn-secondary-hovered hover:border-tertiary",
      )}
    >
      {checked ? (
        <span
          className="fade w-2 h-2 rounded-full"
          style={{
            background: disabled
              ? "var(--color-fill-btn-accent-muted)"
              : "var(--color-fill-accent-primary)",
          }}
        />
      ) : null}
    </span>
    {children ? <span className="label-small text-basic-primary">{children}</span> : null}
  </label>
);

export default Radio;
