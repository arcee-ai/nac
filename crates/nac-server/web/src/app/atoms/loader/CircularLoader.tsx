import React, { useId } from "react";
import { cn } from "../../lib/cn";
import { LoaderSize } from "./index";

/** Stroke colour for the arc; mirrors `LoaderVariant` but as a stroke class. */
export enum CircularLoaderVariant {
  Brand = "stroke-[var(--color-fill-accent-primary)]",
  Neutral = "stroke-[var(--color-fill-basic-primary)]",
  Destructive = "stroke-[var(--color-fill-error-primary)]",
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
const CircularLoader: React.FC<CircularLoaderProps> & {
  Size: typeof LoaderSize;
  Variant: typeof CircularLoaderVariant;
} = ({
  size = LoaderSize.Medium,
  variant = CircularLoaderVariant.Neutral,
  strokeWidth = 2,
  className = "",
  ...props
}) => {
  // Ids have to be unique per instance, or one mask would drive every spinner.
  const scope = useId().replace(/:/g, "");
  const maskId = `circular-loader-mask-${scope}`;
  const gradientId = `circular-loader-gradient-${scope}`;
  const radius = 12 - strokeWidth / 2;

  return (
    <div
      className={cn("inline-flex w-fit h-fit animate-spin", className)}
      {...props}
    >
      <svg
        width={size - 2}
        height={size - 2}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="white" stopOpacity="1" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <rect x="0" y="0" width="12" height="24" fill="white" />
            <rect
              x="12"
              y="0"
              width="12"
              height="24"
              fill={`url(#${gradientId})`}
            />
          </mask>
        </defs>
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          mask={`url(#${maskId})`}
          className={variant}
        />
      </svg>
    </div>
  );
};

CircularLoader.Size = LoaderSize;
CircularLoader.Variant = CircularLoaderVariant;

export default CircularLoader;
