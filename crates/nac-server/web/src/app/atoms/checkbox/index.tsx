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
      "flex items-center gap-2 w-fit",
      disabled ? "cursor-not-allowed opacity-60" : "",
      className,
    )}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      disabled={disabled}
      className="sr-only peer"
      {...props}
    />
    <span
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center shrink-0 w-4 h-4 rounded-[4px] border transition-colors duration-200",
        "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent-primary",
        disabled
          ? "bg-btn-secondary-disabled border-muted"
          : checked
            ? "bg-btn-secondary-accent border-accent-primary hover:bg-btn-secondary-accent-hovered"
            : "bg-btn-secondary border-secondary hover:bg-btn-secondary-hovered hover:border-tertiary",
      )}
    >
      {checked ? (
        <Icon
          iconName={IconName.Check}
          size={14}
          className="fade"
          color="var(--color-fill-accent-primary)"
        />
      ) : null}
    </span>
    {children ? (
      <span className="label-small text-basic-primary">{children}</span>
    ) : null}
  </label>
);

export default Checkbox;
