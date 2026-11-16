import type React from "react";
interface BoxSurfaceProps {
    title?: React.ReactNode;
    headerContent?: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
    bodyClassName?: string;
    children?: React.ReactNode;
}
/**
 * Elevated panel with an optional header (title + trailing slot), a scrollable
 * body and an optional footer. Mirrors the Figma "BoxSurface" component.
 */
declare const BoxSurface: React.FC<BoxSurfaceProps>;
export default BoxSurface;
