import React from "react";
import { cn } from "../../lib/cn";

export enum BadgeColor {
  Neutral = "bg-elevation-sublevel-variant-B text-basic-tertiary border-tertiary",
  Green = "bg-success-secondary text-success-primary border-success-secondary",
  Blue = "bg-info-secondary text-info-primary border-info-secondary",
  Red = "bg-error-secondary text-error-primary border-error-secondary",
  Yellow = "bg-danger-secondary text-danger-primary border-danger-secondary",
  Gray = "bg-elevation-sublevel-variant-A text-basic-secondary border-muted",
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
  /** Filled pill. Off leaves only the uppercase label. */
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
      background ? cn("badge-filled border", color) : PLAIN[color],
      className,
    )}
  >
    {text}
  </span>
);

Badge.Color = BadgeColor;

export default Badge;
