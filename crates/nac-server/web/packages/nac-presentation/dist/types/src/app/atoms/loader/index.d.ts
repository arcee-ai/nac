import type React from "react";
/** Pixel sizes from the Figma Loader component (xs through 4xl). */
export declare enum LoaderSize {
    XSmall = 16,
    Small = 20,
    Medium = 24,
    MediumLarge = 28,
    Large = 32,
    X2Large = 36,
    X3Large = 40,
    XLarge = 48
}
/** CSS color for the spinning glyph, which draws with currentColor. */
export declare enum LoaderVariant {
    Brand = "var(--color-fill-accent-primary)",
    /** Plain, quiet: the tertiary ink, so a loader never shouts over content. */
    Neutral = "var(--color-fill-basic-tertiary)",
    Destructive = "var(--color-fill-error-primary)",
    OnPrimary = "var(--color-fill-btn-primary)"
}
interface LoaderProps extends React.HTMLAttributes<HTMLDivElement> {
    size?: LoaderSize;
    variant?: LoaderVariant;
}
declare const Loader: React.FC<LoaderProps> & {
    Size: typeof LoaderSize;
    Variant: typeof LoaderVariant;
};
export default Loader;
