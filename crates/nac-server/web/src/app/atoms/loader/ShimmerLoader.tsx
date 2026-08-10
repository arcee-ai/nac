import type React from "react";
import { cn } from "../../lib/cn";

interface ShimmerLoaderProps {
  /** Number of placeholder rows. */
  rows?: number;
  className?: string;
  rowClassName?: string;
}

/** Skeleton rows for content whose shape is known before the data arrives. */
const ShimmerLoader: React.FC<ShimmerLoaderProps> = ({
  rows = 3,
  className = "",
  rowClassName = "",
}) => (
  <div className={cn("flex flex-col gap-2", className)}>
    {Array.from({ length: rows }).map((_, index) => (
      <div
        key={index}
        className={cn(
          "relative h-4 rounded-[4px] overflow-hidden bg-elevation-level-2",
          rowClassName,
        )}
      >
        <div
          className="absolute inset-0 animate-shimmer bg-[length:200%_100%] bg-[position:-200%_0]"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, var(--color-bg-btn-secondary-highlighted-hovered) 50%, transparent 100%)",
          }}
        />
      </div>
    ))}
  </div>
);

export default ShimmerLoader;
