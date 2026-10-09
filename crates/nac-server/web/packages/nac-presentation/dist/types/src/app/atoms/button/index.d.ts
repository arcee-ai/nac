import type React from "react";
import { LoaderVariant } from "../loader";
export declare enum ButtonSize {
    Medium = "btn-medium",
    Small = "btn-small",
    Large = "btn-large"
}
export declare enum ButtonVariant {
    Primary = "btn-primary",
    Secondary = "btn-secondary",
    SecondaryHighlighted = "btn-secondary-highlighted",
    SecondaryDestructive = "btn-secondary-destructive",
    SecondaryAccent = "btn-secondary-accent",
    SecondaryAccentHighlighted = "btn-secondary-accent-highlighted",
    Tertiary = "btn-tertiary",
    TertiaryDestructive = "btn-tertiary-destructive",
    TertiaryAccent = "btn-tertiary-accent",
    Ghost = "btn-ghost",
    GhostDestructive = "btn-ghost-destructive",
    GhostAccent = "btn-ghost-accent",
    GhostHighlighted = "btn-ghost-highlighted",
    GhostHighlightedAccent = "btn-ghost-highlighted-accent"
}
export declare enum ButtonContent {
    Icon = "btn-icon",
    IconLeft = "btn-icon-left",
    IconRight = "btn-icon-right",
    Text = "btn-text"
}
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    size?: ButtonSize;
    variant?: ButtonVariant;
    content?: ButtonContent;
    children: React.ReactNode;
    loading?: boolean;
}
export declare const loaderVariant: {
    "btn-primary": LoaderVariant;
    "btn-secondary": LoaderVariant;
    "btn-secondary-highlighted": LoaderVariant;
    "btn-secondary-destructive": LoaderVariant;
    "btn-secondary-accent": LoaderVariant;
    "btn-secondary-accent-highlighted": LoaderVariant;
    "btn-tertiary": LoaderVariant;
    "btn-tertiary-destructive": LoaderVariant;
    "btn-tertiary-accent": LoaderVariant;
    "btn-ghost": LoaderVariant;
    "btn-ghost-destructive": LoaderVariant;
    "btn-ghost-accent": LoaderVariant;
    "btn-ghost-highlighted": LoaderVariant;
    "btn-ghost-highlighted-accent": LoaderVariant;
};
declare const Button: React.FC<ButtonProps> & {
    Size: typeof ButtonSize;
    Variant: typeof ButtonVariant;
    Content: typeof ButtonContent;
};
export default Button;
