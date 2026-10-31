import type * as React from "react";
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
interface ButtonVariantOptions {
    variant?: ButtonVariant;
    size?: ButtonSize;
    content?: ButtonContent;
    disabled?: boolean;
    className?: string;
}
/** NAC's `btn-*` classes, in the call shape shadcn parts expect from `buttonVariants`. */
declare function buttonVariants({ variant, size, content, disabled, className, }?: ButtonVariantOptions): string;
type ButtonProps = React.ComponentProps<"button"> & Omit<ButtonVariantOptions, "className"> & {
    asChild?: boolean;
};
/** A plain button defaults to `type="button"`: NAC forms submit through their own handlers. */
declare function Button({ variant, size, content, disabled, className, asChild, type, ...props }: ButtonProps): React.JSX.Element;
export { Button, buttonVariants };
