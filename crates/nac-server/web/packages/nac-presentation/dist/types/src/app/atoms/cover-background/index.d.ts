import type React from "react";
interface CoverBackgroundProps extends Omit<React.ComponentPropsWithRef<"div">, "children"> {
    open?: boolean;
    zIndex?: number;
    /**
     * Alpha of a custom scrim. Left out, the scrim is the theme's own
     * (`--f-scrim`: a light veil in light mode, a deeper one in dark).
     */
    opacity?: number;
    /** Backdrop blur radius in pixels; 0 leaves what is behind sharp. */
    blur?: number;
}
/**
 * Full-viewport scrim behind an overlay. It fades rather than unmounting, so
 * the owner can keep it around while its panel animates out.
 */
declare const CoverBackground: React.FC<CoverBackgroundProps>;
export default CoverBackground;
