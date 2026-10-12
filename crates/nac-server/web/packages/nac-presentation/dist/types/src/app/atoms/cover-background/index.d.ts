import type React from "react";
interface CoverBackgroundProps {
    open?: boolean;
    zIndex?: number;
    /** Alpha of the black scrim. */
    opacity?: number;
    /** Backdrop blur radius in pixels; 0 leaves what is behind sharp. */
    blur?: number;
    className?: string;
    onClick?: () => void;
}
/**
 * Full-viewport scrim behind an overlay. It fades rather than unmounting, so
 * the owner can keep it around while its panel animates out.
 */
declare const CoverBackground: React.FC<CoverBackgroundProps>;
export default CoverBackground;
