import React from "react";
import { cn } from "../../lib/cn";

/** Soft washes with the matching signal text. No borders: the wash is the shape. */
export enum BadgeColor {
  Neutral = "bg-elevation-sublevel-variant-B text-basic-tertiary",
  Green = "bg-success-primary text-success-primary",
  Blue = "bg-info-primary text-info-primary",
  Red = "bg-error-primary text-error-primary",
  Yellow = "bg-danger-primary text-danger-primary",
  Gray = "bg-elevation-sublevel-variant-A text-basic-secondary",
}

const PLAIN: Record<BadgeColor, string> = {
  [BadgeColor.Neutral]: "text-basic-muted",
  [BadgeColor.Green]: "text-success-primary",
  [BadgeColor.Blue]: "text-info-primary",
  [BadgeColor.Red]: "text-error-primary",
  [BadgeColor.Yellow]: "text-danger-primary",
  [BadgeColor.Gray]: "text-basic-secondary",
};

interface BadgeProps {
  text: string;
  color?: BadgeColor;
  /** Filled pill. Off leaves only the coloured label. */
  background?: boolean;
  className?: string;
}

const Badge: React.FC<BadgeProps> & { Color: typeof BadgeColor } = ({
  text,
  color = BadgeColor.Neutral,
  background = true,
  className = "",
}) => (
  <span
    className={cn(
      "badge inline-flex items-center justify-center whitespace-nowrap rounded-full",
      background ? cn("badge-filled", color) : PLAIN[color],
      className,
    )}
  >
    {text}
  </span>
);

Badge.Color = BadgeColor;

export default Badge;
