import React from "react";

export enum SeparatorVariant {
  Muted = "muted",
  Tertiary = "tertiary",
  Secondary = "secondary",
  Primary = "primary",
}

export enum SeparatorOrientation {
  Horizontal = "horizontal",
  Vertical = "vertical",
}

interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: SeparatorVariant;
  label?: string;
  orientation?: SeparatorOrientation;
  // NOTE: width/height are raw CSS values (e.g. "24px", "50%"), not Tailwind class names.
  width?: string;
  height?: string;
}

const Separator: React.FC<SeparatorProps> & {
  Variant: typeof SeparatorVariant;
  Orientation: typeof SeparatorOrientation;
} = ({
  variant = SeparatorVariant.Muted,
  label,
  orientation = SeparatorOrientation.Horizontal,
  width,
  height,
  className = "",
  ...divProps
}) => {
  // Get border color class based on variant
  const getDividerColorClass = () => {
    switch (variant) {
      case SeparatorVariant.Primary:
        return "bg-divider-primary";
      case SeparatorVariant.Secondary:
        return "bg-divider-secondary";
      case SeparatorVariant.Tertiary:
        return "bg-divider-tertiary";
      case SeparatorVariant.Muted:
      default:
        return "bg-divider-muted";
    }
  };

  // Get text color class based on variant
  const getTextColorClass = () => {
    switch (variant) {
      case SeparatorVariant.Primary:
        return "text-basic-primary";
      case SeparatorVariant.Secondary:
        return "text-basic-secondary";
      case SeparatorVariant.Tertiary:
        return "text-basic-tertiary";
      case SeparatorVariant.Muted:
      default:
        return "text-basic-muted";
    }
  };

  const dividerColorClass = getDividerColorClass();
  const textColorClass = getTextColorClass();
  const { style, ...restDivProps } = divProps;

  if (orientation === SeparatorOrientation.Vertical) {
    // Vertical separator
    const verticalStyle: React.CSSProperties = { ...style };
    if (height) verticalStyle.height = height;
    if (width) verticalStyle.width = width;

    return (
      <div
        className={`h-full w-px ${dividerColorClass} ${className}`}
        style={verticalStyle}
        {...restDivProps}
      />
    );
  }

  // Horizontal separator
  if (label) {
    // Horizontal separator with label
    const horizontalStyle: React.CSSProperties = { ...style };
    if (width) horizontalStyle.width = width;
    if (height) horizontalStyle.height = height;

    return (
      <div
        className={`flex items-center gap-2 w-full ${className}`}
        style={horizontalStyle}
        {...restDivProps}
      >
        <span className={`label-micro ${textColorClass} whitespace-nowrap`}>{label}</span>
        <div className={`flex-1 h-[1px] min-h-[1px] max-h-[1px] ${dividerColorClass}`} />
      </div>
    );
  }

  // Horizontal separator without label
  const horizontalStyle: React.CSSProperties = { ...style };
  if (width) horizontalStyle.width = width;
  if (height) horizontalStyle.height = height;

  return (
    <div
      className={`h-[1px] min-h-[1px] max-h-[1px] w-full ${dividerColorClass} ${className}`}
      style={horizontalStyle}
      {...restDivProps}
    />
  );
};

Separator.Variant = SeparatorVariant;
Separator.Orientation = SeparatorOrientation;

export default Separator;
