import React from "react";
import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";

export enum InputSize {
  Small = "input-small",
  Medium = "input-medium",
  Large = "input-large",
}

export enum InputLeading {
  None = "none",
  Icon = "icon",
  Button = "button",
}

export enum InputTrailing {
  None = "none",
  Icon = "icon",
  Button = "button",
}

const buttonSizeFor: Record<InputSize, ButtonSize> = {
  [InputSize.Small]: ButtonSize.Small,
  [InputSize.Medium]: ButtonSize.Medium,
  [InputSize.Large]: ButtonSize.Large,
};
const iconSizeFor: Record<InputSize, number> = {
  [InputSize.Small]: 16,
  [InputSize.Medium]: 20,
  [InputSize.Large]: 24,
};
const padLeft: Record<InputSize, string> = {
  [InputSize.Small]: "pl-1",
  [InputSize.Medium]: "pl-2",
  [InputSize.Large]: "pl-3",
};
const padRight: Record<InputSize, string> = {
  [InputSize.Small]: "pr-1",
  [InputSize.Medium]: "pr-2",
  [InputSize.Large]: "pr-3",
};
const padLeftIcon: Record<InputSize, string> = {
  [InputSize.Small]: "pl-6",
  [InputSize.Medium]: "pl-9",
  [InputSize.Large]: "pl-12",
};
const padRightIcon: Record<InputSize, string> = {
  [InputSize.Small]: "pr-7",
  [InputSize.Medium]: "pr-11",
  [InputSize.Large]: "pr-14",
};
const leadingIconPos: Record<InputSize, string> = {
  [InputSize.Small]: "top-1 left-1",
  [InputSize.Medium]: "top-2 left-2",
  [InputSize.Large]: "top-3 left-3",
};
const trailingIconPos: Record<InputSize, string> = {
  [InputSize.Small]: "top-1 right-1",
  [InputSize.Medium]: "top-2 right-2",
  [InputSize.Large]: "top-3 right-3",
};

interface InputWrapperProps {
  label?: React.ReactNode;
  required?: boolean;
  validation?: boolean;
  validationText?: string;
  hintText?: string;
  className?: string;
  children?: React.ReactNode;
}

const InputWrapper: React.FC<InputWrapperProps> = ({
  label,
  required,
  validation,
  validationText,
  hintText,
  className,
  children,
}) => (
  <div className={cn("flex text-left flex-col gap-1", className)}>
    {label ? (
      <div className="flex gap-2 items-center">
        <label
          className={cn(
            "label-small",
            validation ? "text-error-primary" : "text-basic-secondary",
          )}
        >
          {label}
        </label>
        {required ? (
          <div
            className={cn(
              "text-micro",
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

interface InputProps
  extends Omit<React.ComponentPropsWithRef<"input">, "size"> {
  inputSize?: InputSize;
  leading?: InputLeading;
  leadingOnClick?: () => void;
  trailing?: InputTrailing;
  trailingOnClick?: () => void;
  leadingIconName?: IconName;
  trailingIconName?: IconName;
  inputClassName?: string;
  label?: React.ReactNode;
  required?: boolean;
  rounded?: boolean;
  isDisabled?: boolean;
  validation?: boolean;
  validationText?: string;
  hintText?: string;
}

const Input: React.FC<InputProps> & {
  Size: typeof InputSize;
  Leading: typeof InputLeading;
  Trailing: typeof InputTrailing;
} = ({
  inputSize = InputSize.Large,
  leading = InputLeading.None,
  leadingOnClick,
  trailing = InputTrailing.None,
  trailingOnClick,
  leadingIconName = IconName.Add,
  trailingIconName = IconName.Search,
  inputClassName = "",
  label = "",
  required = false,
  rounded = false,
  placeholder = "",
  isDisabled = false,
  validation = false,
  validationText = "",
  hintText,
  className = "",
  ref,
  ...props
}) => {
  const inputClasses = cn(
    "w-full input font-normal",
    inputSize,
    inputClassName,
    rounded ? "rounded-full" : "rounded-[4px]",
    leading === InputLeading.None ? padLeft[inputSize] : padLeftIcon[inputSize],
    trailing === InputTrailing.None
      ? padRight[inputSize]
      : padRightIcon[inputSize],
    isDisabled && "input-disabled",
    validation && "input-validation",
  );
  const iconColor = isDisabled
    ? "var(--color-fill-basic-muted)"
    : "var(--color-fill-btn-secondary)";

  return (
    <InputWrapper
      label={label}
      required={required}
      validation={validation}
      validationText={validationText}
      hintText={hintText}
      className={className}
    >
      <div className="input-wrapper relative w-full h-fit">
        {leading === InputLeading.Icon ? (
          <Icon
            iconName={leadingIconName}
            size={iconSizeFor[inputSize]}
            className={cn("absolute", leadingIconPos[inputSize])}
            color={iconColor}
          />
        ) : null}
        {leading === InputLeading.Button ? (
          <Button
            size={buttonSizeFor[inputSize]}
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Icon}
            onClick={leadingOnClick}
            className={cn("input-btn-leading", !rounded && "rounded-lg")}
          >
            <Icon iconName={leadingIconName} />
          </Button>
        ) : null}

        <input
          ref={ref}
          className={inputClasses}
          placeholder={placeholder}
          disabled={isDisabled}
          {...props}
        />

        {trailing === InputTrailing.Icon ? (
          <Icon
            iconName={trailingIconName}
            size={iconSizeFor[inputSize]}
            className={cn("absolute", trailingIconPos[inputSize])}
            color={iconColor}
          />
        ) : null}
        {trailing === InputTrailing.Button ? (
          <Button
            size={buttonSizeFor[inputSize]}
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Icon}
            onClick={trailingOnClick}
            className={cn("input-btn-trailing", !rounded && "rounded-lg")}
          >
            <Icon iconName={trailingIconName} />
          </Button>
        ) : null}
      </div>
    </InputWrapper>
  );
};

Input.Size = InputSize;
Input.Leading = InputLeading;
Input.Trailing = InputTrailing;

export default Input;
