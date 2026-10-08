import React from "react";
import { LoaderSize } from "./index";
/** Stroke colour for the arc; mirrors `LoaderVariant` but as a stroke class. */
export declare enum CircularLoaderVariant {
    Brand = "stroke-[var(--color-fill-accent-primary)]",
    Neutral = "stroke-[var(--color-fill-basic-primary)]",
    Destructive = "stroke-[var(--color-fill-error-primary)]"
}
interface CircularLoaderProps extends React.HTMLAttributes<HTMLDivElement> {
    size?: LoaderSize;
    variant?: CircularLoaderVariant;
    strokeWidth?: number;
}
/**
 * Spinner drawn as a ring that fades out along its tail, for places where the
 * glyph-based `Loader` reads as too heavy.
 */
declare const CircularLoader: React.FC<CircularLoaderProps> & {
    Size: typeof LoaderSize;
    Variant: typeof CircularLoaderVariant;
};
export default CircularLoader;
