import type React from "react";
import { cn } from "../../lib/cn";
import Label, { LabelSize, type HoverHintConfig } from "../label";

export interface InputWrapperProps {
  label?: React.ReactNode;
  required?: boolean;
  validation?: boolean;
  validationText?: string;
  hintText?: string;
  /** Large fields use a 14px caption. Compact fields use 12px. */
  caption?: "large" | "compact";
  /** Info glyph beside the label, for the explanation that will not fit inline. */
  hoverHint?: HoverHintConfig;
  className?: string;
  children?: React.ReactNode;
}

/** Label, required marker and hint / validation line around a form control. */
const InputWrapper: React.FC<InputWrapperProps> = ({
  label,
  required,
  validation,
  validationText,
  hintText,
  caption,
  hoverHint,
  className,
  children,
}) => {
  const labelSize = caption === "compact" ? LabelSize.Micro : LabelSize.Small;
  const captionClass =
    caption === "compact" ? "label-micro" : caption === "large" ? "label-small" : "text-micro";

  return (
    <div className={cn("flex text-left flex-col gap-1", className)}>
      {label ? (
        <div className="flex items-baseline gap-1 min-w-0">
          <Label
            validation={validation}
            hoverHint={hoverHint}
            tone="primary"
            size={labelSize}
            className="min-w-0"
          >
            {label}
          </Label>
          {required ? (
            <span
              className={cn(
                "label-small shrink-0",
                validation ? "text-error-primary" : "text-basic-primary",
              )}
            >
              *
            </span>
          ) : null}
        </div>
      ) : null}
      {children}
      {validation && validationText ? (
        <p className={cn(captionClass, "text-error-primary")}>{validationText}</p>
      ) : !validation && hintText ? (
        <p className="text-micro text-basic-muted">{hintText}</p>
      ) : null}
    </div>
  );
};

export default InputWrapper;
