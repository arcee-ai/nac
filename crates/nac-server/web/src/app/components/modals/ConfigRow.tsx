import type React from "react";

import { Icon, IconName, Tooltip, TooltipPosition } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

export function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip title={text} position={TooltipPosition.BottomLeft}>
      <Icon iconName={IconName.Info} className="text-basic-muted shrink-0" />
    </Tooltip>
  );
}

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
      <div className={cn("label-small", invalid ? "text-error-primary" : "text-basic-primary")}>
        {label}
      </div>
      {hint ? <InfoHint text={hint} /> : null}
      {required ? (
        <div className="flex-1 text-right text-micro text-basic-muted">Required</div>
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
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 w-full min-h-5">
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <div
          className={cn(
            "truncate",
            secondary ? "text-micro" : "label-micro",
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
        {hint ? <InfoHint text={hint} /> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export function ConfigDivider() {
  return <div className="h-px w-full bg-divider-muted" />;
}

export function ConfigTextArea({
  label,
  help,
  placeholder,
  value,
  onChange,
  className,
}: {
  label: string;
  help?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="label-micro text-basic-primary">{label}</div>
      <textarea
        className={cn(
          "input rounded-[4px] px-3 py-2 resize-none font-normal leading-relaxed",
          className,
        )}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {help ? <div className="text-micro text-basic-muted">{help}</div> : null}
    </div>
  );
}
