import React from "react";
export declare enum SeparatorVariant {
    Muted = "muted",
    Tertiary = "tertiary",
    Secondary = "secondary",
    Primary = "primary"
}
export declare enum SeparatorOrientation {
    Horizontal = "horizontal",
    Vertical = "vertical"
}
interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: SeparatorVariant;
    label?: string;
    orientation?: SeparatorOrientation;
    width?: string;
    height?: string;
}
declare const Separator: React.FC<SeparatorProps> & {
    Variant: typeof SeparatorVariant;
    Orientation: typeof SeparatorOrientation;
};
export default Separator;
