import type React from "react";
import { cn } from "../../lib/cn";

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
const CoverBackground: React.FC<CoverBackgroundProps> = ({
  open = false,
  zIndex = 40,
  opacity,
  blur = 0,
  className = "",
  style,
  ...props
}) => (
  <div
    className={cn(
      "fixed inset-0 transition-opacity duration-200 ease-out motion-reduce:transition-none",
      open ? "opacity-100" : "opacity-0 pointer-events-none",
      className,
    )}
    style={{
      background: opacity == null ? "var(--f-scrim)" : `oklch(0.14 0.006 85 / ${opacity})`,
      zIndex,
      backdropFilter: blur ? `blur(${blur}px)` : undefined,
      ...style,
    }}
    {...props}
  />
);

export default CoverBackground;
