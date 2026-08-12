import React from "react";

// Enums
export enum BadgeColor {
  Neutral = "bg-sublevel-variant-B text-primary border-muted",
  Green = "bg-success-tertiary text-success-primary border-success-muted",
  Blue = "bg-info-tertiary text-info-primary border-info-muted",
  Red = "bg-error-tertiary text-error-primary border-error-muted",
  Yellow = "bg-danger-tertiary  text-danger-primary border-danger-muted",
  Gray = "bg-sublevel-variant-A text-basic-secondary border-muted",
}

// Props
interface BadgeProps {
  text: string;
  color?: BadgeColor;
  className?: string;
}

const Badge: React.FC<BadgeProps> & { Color: typeof BadgeColor } = ({
  text,
  color = BadgeColor.Neutral,
  className = "",
}) => {
  const badgeClasses = [
    "inline-block tag-label px-[8px] py-[3px] border rounded-full",
    color,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <span className={badgeClasses}>{text}</span>;
};

// Attach enums to the Badge object
Badge.Color = BadgeColor;

export default Badge;
