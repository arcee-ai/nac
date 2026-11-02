import type React from "react";
import { cn } from "../../lib/cn";
import InputWrapper from "./InputWrapper";

/** Utilities rather than `.input-*` rules, so callers can still override height and type. */
export enum TextAreaSize {
  Small = "h-[93px] p-1 text-micro",
  Medium = "h-[86px] p-2 text-small",
  Large = "h-[120px] p-3 text-medium",
}

interface TextAreaProps extends Omit<React.ComponentPropsWithRef<"textarea">, "size"> {
  textAreaSize?: TextAreaSize;
  label?: React.ReactNode;
  required?: boolean;
  isDisabled?: boolean;
  validation?: boolean;
  validationText?: string;
  hintText?: string;
  textAreaClassName?: string;
}

/** Multi-line counterpart of `Input`, sharing its chrome and validation line. */
const TextArea: React.FC<TextAreaProps> & { Size: typeof TextAreaSize } = ({
  textAreaSize = TextAreaSize.Medium,
  label = "",
  required = false,
  isDisabled = false,
  validation = false,
  validationText = "",
  hintText,
  className = "",
  textAreaClassName = "",
  ref,
  ...props
}) => (
  <InputWrapper
    label={label}
    required={required}
    validation={validation}
    validationText={validationText}
    hintText={hintText}
    caption={textAreaSize === TextAreaSize.Large ? "large" : "compact"}
    className={className}
  >
    <textarea
      ref={ref}
      className={cn(
        "w-full input font-normal rounded-interaction",
        textAreaSize,
        isDisabled && "input-disabled",
        validation && "input-validation",
        textAreaClassName,
      )}
      disabled={isDisabled}
      {...props}
    />
  </InputWrapper>
);

TextArea.Size = TextAreaSize;

export default TextArea;
