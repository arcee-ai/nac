import type React from "react";
import { cn } from "../../lib/cn";

interface CoverBackgroundProps extends Omit<React.ComponentPropsWithRef<"div">, "children"> {
  open?: boolean;
  zIndex?: number;
  /** Alpha of the black scrim. */
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
  opacity = 0.25,
  blur = 2,
  className = "",
  style,
  ...props
}) => (
  <div
    className={cn(
      "fixed inset-0 transition-opacity duration-150 ease-out motion-reduce:transition-none",
      open ? "opacity-100" : "opacity-0 pointer-events-none",
      className,
    )}
    style={{
      background: `rgba(0, 0, 0, ${opacity})`,
      zIndex,
      backdropFilter: blur ? `blur(${blur}px)` : undefined,
      ...style,
    }}
    {...props}
  />
);

export default CoverBackground;
