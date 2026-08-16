import type React from "react";
import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";

export enum MessageBoxVariant {
  Info = "info",
  Error = "error",
  Danger = "danger",
  Success = "success",
}

export enum MessageBoxSize {
  Small = "small",
  Medium = "medium",
  Large = "large",
}

const variantClasses = {
  [MessageBoxVariant.Info]:
    "bg-info-primary text-info-primary border-info-primary",
  [MessageBoxVariant.Error]:
    "bg-error-primary text-error-primary border-error-primary",
  [MessageBoxVariant.Danger]:
    "bg-danger-primary text-danger-primary border-danger-primary",
  [MessageBoxVariant.Success]:
    "bg-success-primary text-success-primary border-success-primary",
} satisfies Record<MessageBoxVariant, string>;

const variantIcons = {
  [MessageBoxVariant.Info]: IconName.Info,
  [MessageBoxVariant.Error]: IconName.Danger,
  [MessageBoxVariant.Danger]: IconName.Danger,
  [MessageBoxVariant.Success]: IconName.CheckCircle,
} satisfies Record<MessageBoxVariant, IconName>;

const variantFills = {
  [MessageBoxVariant.Info]: "var(--color-fill-info-primary)",
  [MessageBoxVariant.Error]: "var(--color-fill-error-primary)",
  [MessageBoxVariant.Danger]: "var(--color-fill-danger-primary)",
  [MessageBoxVariant.Success]: "var(--color-fill-success-primary)",
} satisfies Record<MessageBoxVariant, string>;

const sizeClasses = {
  [MessageBoxSize.Small]: "p-2 gap-2",
  [MessageBoxSize.Medium]: "p-3 gap-2",
  [MessageBoxSize.Large]: "p-4 gap-3",
} satisfies Record<MessageBoxSize, string>;

const titleClasses = {
  [MessageBoxSize.Small]: "label-micro",
  [MessageBoxSize.Medium]: "label-small",
  [MessageBoxSize.Large]: "label-medium",
} satisfies Record<MessageBoxSize, string>;

const bodyClasses = {
  [MessageBoxSize.Small]: "text-micro",
  [MessageBoxSize.Medium]: "text-small",
  [MessageBoxSize.Large]: "text-medium",
} satisfies Record<MessageBoxSize, string>;

const iconSizes = {
  [MessageBoxSize.Small]: 16,
  [MessageBoxSize.Medium]: 20,
  [MessageBoxSize.Large]: 24,
} satisfies Record<MessageBoxSize, number>;

interface MessageBoxProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  title?: React.ReactNode;
  variant?: MessageBoxVariant;
  size?: MessageBoxSize;
}

/** Inline notice tied to the surrounding content, as opposed to a toast. */
const MessageBox: React.FC<MessageBoxProps> & {
  Variant: typeof MessageBoxVariant;
  Size: typeof MessageBoxSize;
} = ({
  title,
  variant = MessageBoxVariant.Info,
  size = MessageBoxSize.Small,
  className = "",
  children,
  ...props
}) => (
  <div
    className={cn(
      "flex rounded-[4px] border",
      variantClasses[variant],
      sizeClasses[size],
      className,
    )}
    {...props}
  >
    <Icon
      iconName={variantIcons[variant]}
      size={iconSizes[size]}
      color={variantFills[variant]}
      className="shrink-0"
    />
    <div className="flex-1 min-w-0 flex flex-col gap-1">
      {title ? <div className={titleClasses[size]}>{title}</div> : null}
      {children ? (
        <div className={cn("opacity-80", bodyClasses[size])}>{children}</div>
      ) : null}
    </div>
  </div>
);

MessageBox.Variant = MessageBoxVariant;
MessageBox.Size = MessageBoxSize;

export default MessageBox;
