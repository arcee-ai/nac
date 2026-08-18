import type React from "react";

import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";
import { InputLeading, InputTrailing } from "./index";

export enum StickyInputVariant {
  Default = "default",
  Search = "search",
}

interface StickyInputProps extends Omit<React.ComponentPropsWithRef<"input">, "size"> {
  variant?: StickyInputVariant;
  leading?: InputLeading;
  leadingOnClick?: () => void;
  trailing?: InputTrailing;
  trailingOnClick?: () => void;
  leadingIconName?: IconName;
  trailingIconName?: IconName;
  inputClassName?: string;
  /** Applied to the elevated wrapper rather than the field itself. */
  className?: string;
  rounded?: boolean;
  isDisabled?: boolean;
  validation?: boolean;
  /** Search variant only: clears the field through its trailing button. */
  onClear?: () => void;
}

const StickyInput: React.FC<StickyInputProps> & {
  Variant: typeof StickyInputVariant;
  Leading: typeof InputLeading;
  Trailing: typeof InputTrailing;
} = ({
  variant = StickyInputVariant.Default,
  leading = InputLeading.None,
  leadingOnClick,
  trailing = InputTrailing.None,
  trailingOnClick,
  leadingIconName = IconName.Add,
  trailingIconName = IconName.Search,
  inputClassName = "",
  className = "",
  rounded = true,
  isDisabled = false,
  validation = false,
  onClear,
  value,
  ref,
  ...props
}) => {
  const isSearch = variant === StickyInputVariant.Search;
  const hasText = value != null && String(value).length > 0;

  const actualLeading = isSearch ? InputLeading.Icon : leading;
  const actualLeadingIconName = isSearch ? IconName.Search : leadingIconName;
  // The clear button only earns its slot once there is something to clear.
  const actualTrailing = isSearch
    ? hasText
      ? InputTrailing.Button
      : InputTrailing.None
    : trailing;
  const actualTrailingIconName = isSearch ? IconName.Close : trailingIconName;
  const actualTrailingOnClick = isSearch ? onClear : trailingOnClick;

  const stretches = className.includes("flex-grow") || className.includes("flex-1");
  const radius = rounded ? "rounded-full" : "rounded-[4px]";
  const iconColor = isDisabled
    ? "var(--color-fill-basic-muted)"
    : "var(--color-fill-btn-secondary)";

  // Spelled out rather than built from a template, because Tailwind only emits
  // utilities whose class name appears literally in the source.
  const leadingPadding = {
    [InputLeading.None]: "pl-3",
    // The icon sits 8px in and is 24px wide, leaving an 8px gap before the text.
    [InputLeading.Icon]: "pl-10",
    [InputLeading.Button]: "pl-12",
  }[actualLeading];
  const trailingPadding = {
    [InputTrailing.None]: "pr-3",
    [InputTrailing.Icon]: "pr-10",
    [InputTrailing.Button]: "pr-12",
  }[actualTrailing];

  return (
    <div
      className={cn(
        "bg-elevation-level-3 shadow-2xl overflow-hidden h-10",
        stretches ? "flex w-full" : "inline-flex w-fit",
        radius,
        className,
      )}
    >
      <div className="input-wrapper relative w-full h-full">
        {actualLeading === InputLeading.Icon ? (
          <Icon
            iconName={actualLeadingIconName}
            size={24}
            className="absolute top-2 left-2"
            color={iconColor}
          />
        ) : null}
        {actualLeading === InputLeading.Button ? (
          <Button
            size={ButtonSize.Large}
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Icon}
            onClick={leadingOnClick}
            className="btn-sticky input-btn-leading"
          >
            <Icon iconName={actualLeadingIconName} />
          </Button>
        ) : null}

        <input
          ref={ref}
          className={cn(
            "w-full input input-sticky font-normal",
            radius,
            leadingPadding,
            trailingPadding,
            isDisabled && "input-disabled",
            validation && "input-validation",
            inputClassName,
          )}
          disabled={isDisabled}
          value={value}
          {...props}
        />

        {actualTrailing === InputTrailing.Icon ? (
          <Icon
            iconName={actualTrailingIconName}
            size={24}
            className="absolute top-2 right-2"
            color={iconColor}
          />
        ) : null}
        {actualTrailing === InputTrailing.Button ? (
          <Button
            size={ButtonSize.Large}
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Icon}
            onClick={actualTrailingOnClick}
            aria-label={isSearch ? "Clear search" : undefined}
            className="btn-sticky input-btn-trailing"
          >
            <Icon iconName={actualTrailingIconName} />
          </Button>
        ) : null}
      </div>
    </div>
  );
};

StickyInput.Variant = StickyInputVariant;
StickyInput.Leading = InputLeading;
StickyInput.Trailing = InputTrailing;

export default StickyInput;
