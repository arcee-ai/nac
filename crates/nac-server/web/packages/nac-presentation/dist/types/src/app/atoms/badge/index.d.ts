import React from "react";
/** Soft washes with the matching signal text. No borders: the wash is the shape. */
export declare enum BadgeColor {
    Neutral = "bg-elevation-sublevel-variant-B text-basic-tertiary",
    Green = "bg-success-primary text-success-primary",
    Blue = "bg-info-primary text-info-primary",
    Red = "bg-error-primary text-error-primary",
    Yellow = "bg-danger-primary text-danger-primary",
    Gray = "bg-elevation-sublevel-variant-A text-basic-secondary"
}
interface BadgeProps {
    text: string;
    color?: BadgeColor;
    /** Filled pill. Off leaves only the coloured label. */
    background?: boolean;
    className?: string;
}
declare const Badge: React.FC<BadgeProps> & {
    Color: typeof BadgeColor;
};
export default Badge;
