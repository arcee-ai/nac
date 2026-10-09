import type React from "react";
import type { HoverHintConfig } from "../label";
export declare enum TabButtonSize {
    Large = "btn-large",
    Medium = "btn-medium",
    Small = "btn-small"
}
export declare enum TabButtonVariant {
    Regular = "btn-ghost",
    Accent = "btn-ghost-accent",
    Destructive = "btn-ghost-destructive"
}
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    size?: TabButtonSize;
    variant?: TabButtonVariant;
    children: React.ReactNode;
    active?: boolean;
    /** Info glyph at the end of the row, after any shortcut. Its hover text explains the row. */
    hoverHint?: HoverHintConfig;
    /** Sits before the hover hint, for a shortcut or other trailing affordance. */
    trailing?: React.ReactNode;
}
declare const TabButton: React.FC<ButtonProps> & {
    Size: typeof TabButtonSize;
    Variant: typeof TabButtonVariant;
};
export default TabButton;
