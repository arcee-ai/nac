import React, { useId } from "react";
import { cn } from "../../lib/cn";
import { Input as UIInput } from "../../ui/input";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";
import InputWrapper from "./InputWrapper";

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

const buttonSizeFor = {
  [InputSize.Small]: ButtonSize.Small,
  [InputSize.Medium]: ButtonSize.Medium,
  [InputSize.Large]: ButtonSize.Large,
} satisfies Record<InputSize, ButtonSize>;
const iconSizeFor = {
  [InputSize.Small]: 16,
  [InputSize.Medium]: 20,
  [InputSize.Large]: 24,
} satisfies Record<InputSize, number>;
const padLeft = {
  [InputSize.Small]: "pl-1",
  [InputSize.Medium]: "pl-2",
  [InputSize.Large]: "pl-3",
} satisfies Record<InputSize, string>;
const padRight = {
  [InputSize.Small]: "pr-1",
  [InputSize.Medium]: "pr-2",
  [InputSize.Large]: "pr-3",
} satisfies Record<InputSize, string>;
const padLeftIcon = {
  [InputSize.Small]: "pl-6",
  [InputSize.Medium]: "pl-9",
  [InputSize.Large]: "pl-12",
} satisfies Record<InputSize, string>;
const padRightIcon = {
  [InputSize.Small]: "pr-6",
  [InputSize.Medium]: "pr-9",
  [InputSize.Large]: "pr-12",
} satisfies Record<InputSize, string>;
const leadingIconPos = {
  [InputSize.Small]: "top-1 left-1",
  [InputSize.Medium]: "top-2 left-2",
  [InputSize.Large]: "top-3 left-3",
} satisfies Record<InputSize, string>;
const trailingIconPos = {
  [InputSize.Small]: "top-1 right-1",
  [InputSize.Medium]: "top-2 right-2",
  [InputSize.Large]: "top-3 right-3",
} satisfies Record<InputSize, string>;

interface InputProps extends Omit<React.ComponentPropsWithRef<"input">, "size"> {
  inputSize?: InputSize;
  leading?: InputLeading;
  leadingOnClick?: () => void;
  /** Occupies the leading slot with arbitrary content, e.g. a status glyph. */
  leadingSlot?: React.ReactNode;
  trailing?: InputTrailing;
  trailingOnClick?: () => void;
  leadingIconName?: IconName;
  trailingIconName?: IconName;
  inputClassName?: string;
  label?: React.ReactNode;
  required?: boolean;
  rounded?: boolean;
  isDisabled?: boolean;
  /** The value is being submitted: the field reads as busy and stops taking edits. */
  loading?: boolean;
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
  leadingSlot,
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
  loading = false,
  validation = false,
  validationText = "",
  hintText,
  className = "",
  id,
  readOnly,
  "aria-describedby": ariaDescribedBy,
  ref,
  ...props
}) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const description = validation ? validationText : hintText;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const describedBy = [descriptionId, ariaDescribedBy].filter(Boolean).join(" ") || undefined;
  const hasLeading = leading !== InputLeading.None || Boolean(leadingSlot);
  const hasTrailing = trailing !== InputTrailing.None;
  const largeSearch = inputSize === InputSize.Large && hasLeading && !hasTrailing;
  const inputClasses = cn(
    "w-full input font-normal",
    inputSize,
    inputClassName,
    rounded ? "rounded-full" : "rounded-interaction",
    !hasLeading ? padLeft[inputSize] : largeSearch ? "input-pad-search" : padLeftIcon[inputSize],
    !hasTrailing ? padRight[inputSize] : padRightIcon[inputSize],
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
      caption={inputSize === InputSize.Large ? "large" : "compact"}
      htmlFor={inputId}
      descriptionId={descriptionId}
      className={className}
    >
      <div className="input-wrapper relative w-full h-fit">
        {leadingSlot ? (
          <div
            className={cn(
              "absolute flex items-center justify-center",
              largeSearch ? "top-3 left-1.5" : leadingIconPos[inputSize],
            )}
            style={{
              width: iconSizeFor[inputSize],
              height: iconSizeFor[inputSize],
            }}
          >
            {leadingSlot}
          </div>
        ) : null}
        {!leadingSlot && leading === InputLeading.Icon ? (
          <Icon
            iconName={leadingIconName}
            size={iconSizeFor[inputSize]}
            className={cn("absolute", largeSearch ? "top-3 left-1.5" : leadingIconPos[inputSize])}
            color={iconColor}
          />
        ) : null}
        {!leadingSlot && leading === InputLeading.Button ? (
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

        <UIInput
          ref={ref}
          id={inputId}
          className={inputClasses}
          placeholder={placeholder}
          disabled={isDisabled}
          readOnly={loading || readOnly}
          aria-busy={loading || undefined}
          aria-invalid={validation || undefined}
          aria-required={required || undefined}
          aria-describedby={describedBy}
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
