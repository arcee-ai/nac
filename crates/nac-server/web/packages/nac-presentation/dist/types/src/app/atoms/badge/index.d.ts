import React from "react";
export declare enum BadgeColor {
    Neutral = "bg-elevation-sublevel-variant-B text-basic-tertiary border-tertiary",
    Green = "bg-success-secondary text-success-primary border-success-secondary",
    Blue = "bg-info-secondary text-info-primary border-info-secondary",
    Red = "bg-error-secondary text-error-primary border-error-secondary",
    Yellow = "bg-danger-secondary text-danger-primary border-danger-secondary",
    Gray = "bg-elevation-sublevel-variant-A text-basic-secondary border-muted"
}
interface BadgeProps {
    text: string;
    color?: BadgeColor;
    /** Filled pill. Off leaves only the uppercase label. */
    background?: boolean;
    className?: string;
}
declare const Badge: React.FC<BadgeProps> & {
    Color: typeof BadgeColor;
};
export default Badge;
