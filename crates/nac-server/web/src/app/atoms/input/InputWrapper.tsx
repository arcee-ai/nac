import type React from "react";
import { cn } from "../../lib/cn";
import Label, { type HoverHintConfig } from "../label";

export interface InputWrapperProps {
  label?: React.ReactNode;
  required?: boolean;
  validation?: boolean;
  validationText?: string;
  hintText?: string;
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
  hoverHint,
  className,
  children,
}) => (
  <div className={cn("flex text-left flex-col gap-1", className)}>
    {label ? (
      <div className="flex gap-2 items-center">
        <Label validation={validation} hoverHint={hoverHint} className="flex-1">
          {label}
        </Label>
        {required ? (
          <div
            className={cn(
              "text-micro shrink-0",
              validation ? "text-error-secondary" : "text-basic-tertiary",
            )}
          >
            * Required
          </div>
        ) : null}
      </div>
    ) : null}
    {children}
    {validation && validationText ? (
      <p className="pt-1 text-error-primary text-micro">{validationText}</p>
    ) : !validation && hintText ? (
      <p className="pt-1 text-basic-muted text-micro">{hintText}</p>
    ) : null}
  </div>
);

export default InputWrapper;
