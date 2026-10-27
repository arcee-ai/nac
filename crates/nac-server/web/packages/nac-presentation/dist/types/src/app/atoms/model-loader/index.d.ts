import type React from "react";
/** Box sizes from the Figma ModelLoader: 16, 20 and 24px. */
export declare enum ModelLoaderSize {
    Small = "small",
    Medium = "medium",
    Large = "large"
}
export declare enum ModelLoaderVariant {
    Default = "default",
    Accent = "accent"
}
/** One of the Figma example frames (Example#1–3). */
export type ModelLoaderFrame = 1 | 2 | 3;
interface ModelLoaderProps {
    size?: ModelLoaderSize;
    variant?: ModelLoaderVariant;
    /** Freezes the grid on an example frame instead of animating it. */
    frame?: ModelLoaderFrame;
    /** Announces the loader as a status. Without one it is decorative. */
    label?: string;
    className?: string;
}
/**
 * The "model is working" indicator: a 4×4 dot grid whose dots reshuffle their
 * opacity every tick. The box never changes size, so swapping it in for an
 * icon of the same size does not move the layout.
 *
 * The animation runs on the Web Animations API, so a tick never re-renders.
 * An explicit `frame` or a reduced-motion preference leaves a still frame.
 */
declare const ModelLoader: React.FC<ModelLoaderProps> & {
    Size: typeof ModelLoaderSize;
    Variant: typeof ModelLoaderVariant;
};
export default ModelLoader;
