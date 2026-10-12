import React from "react";
export declare enum BadgeColor {
    Neutral = "bg-elevation-sublevel-variant-B text-basic-secondary border-tertiary",
    Green = "bg-success-tertiary text-success-primary border-success-muted",
    Blue = "bg-info-tertiary text-info-primary border-info-muted",
    Red = "bg-error-tertiary text-error-primary border-error-muted",
    Yellow = "bg-danger-tertiary  text-danger-primary border-danger-muted",
    Violet = "bg-indigo-400 text-indigo-800 border-indigo-300",
    Gray = "bg-elevation-sublevel-variant-A text-basic-secondary border-muted"
}
interface BadgeProps {
    text: string;
    color?: BadgeColor;
    className?: string;
}
declare const Badge: React.FC<BadgeProps> & {
    Color: typeof BadgeColor;
};
export default Badge;
