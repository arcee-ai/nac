import type React from "react";

import { HoverHint, TooltipPosition } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

/** Width every control on the right-hand side of a row shares. */
export const CONTROL_WIDTH = "w-full md:w-[280px]";

export function FieldLabel({
  label,
  hint,
  required = false,
  invalid = false,
}: {
  label: string;
  hint?: string;
  /** Marks the field with the asterisk the form's footnote explains. */
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
        {required ? "*" : ""}
      </div>
      {hint ? (
        <HoverHint title={hint} position={TooltipPosition.TopCenter} />
      ) : null}
    </div>
  );
}

/**
 * One line inside the Configurations box: label left, control right. With
 * `verticalOnMobile` a phone stacks the two instead, which is what a long label
 * next to a wide control needs to stay readable.
 */
export function ConfigRow({
  label,
  hint,
  required = false,
  invalid = false,
  secondary = false,
  muted = false,
  verticalOnMobile = false,
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
  /** Stacks label over control on a phone instead of keeping them on one line. */
  verticalOnMobile?: boolean;
  /** Widens the label past the cap a narrow box needs, e.g. `max-w-none`. */
  labelClassName?: string;
  control: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex w-full min-h-9 md:flex-row items-center md:justify-between md:min-h-5",
        verticalOnMobile
          ? "flex-col items-stretch justify-center gap-1"
          : "flex-row items-center justify-between",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1 min-w-0 md:flex-1 md:max-w-[220px]",
          verticalOnMobile ? "max-w-none" : "flex-1 max-w-[220px]",
          labelClassName,
        )}
      >
        <div
          className={cn(
            // Stacked, the label has the whole width and may wrap; side by side
            // it has to give way to the control.
            verticalOnMobile ? "md:truncate" : "truncate",
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
      <div className={cn("shrink-0", verticalOnMobile && "w-full md:w-auto")}>
        {control}
      </div>
    </div>
  );
}
