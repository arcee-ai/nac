import type React from "react";

import { HoverHint, TooltipPosition } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

export function FieldLabel({
  label,
  hint,
  required = false,
  invalid = false,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 w-full">
      <div
        className={cn(
          "label-small",
          invalid ? "text-error-primary" : "text-basic-primary",
        )}
      >
        {label}
      </div>
      {hint ? (
        <HoverHint title={hint} position={TooltipPosition.TopCenter} />
      ) : null}
      {required ? (
        <div className="flex-1 text-right text-micro text-basic-muted">
          Required
        </div>
      ) : null}
    </div>
  );
}

/** One line inside the Configurations box: label left, control right. */
export function ConfigRow({
  label,
  hint,
  required = false,
  invalid = false,
  secondary = false,
  muted = false,
  labelClassName = "",
  control,
}: {
  label: string;
  hint?: string;
  /** Marks the field with the asterisk the box's footnote explains. */
  required?: boolean;
  invalid?: boolean;
  secondary?: boolean;
  /** Dims the label while the row is waiting on something else. */
  muted?: boolean;
  /** Widens the label past the cap a narrow box needs, e.g. `max-w-none`. */
  labelClassName?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between w-full min-h-5">
      <div
        className={cn(
          "flex items-center gap-1 flex-1 min-w-0 max-w-[220px]",
          labelClassName,
        )}
      >
        <div
          className={cn(
            "truncate",
            secondary ? "text-small" : "label-small",
            invalid
              ? "text-error-primary"
              : muted
                ? "text-basic-muted"
                : secondary
                  ? "text-basic-secondary"
                  : "text-basic-primary",
          )}
        >
          {label}
          {required ? "*" : ""}
        </div>
        {hint ? (
          <HoverHint title={hint} position={TooltipPosition.TopCenter} />
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
