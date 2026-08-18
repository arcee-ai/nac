import type React from "react";
import { cn } from "../../lib/cn";
import InputWrapper from "./InputWrapper";

export enum TextAreaSize {
  Small = "p-2 text-micro",
  Medium = "p-3 text-small",
  Large = "p-4 text-medium",
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
    className={className}
  >
    <textarea
      ref={ref}
      className={cn(
        "w-full input font-normal rounded-[4px]",
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
