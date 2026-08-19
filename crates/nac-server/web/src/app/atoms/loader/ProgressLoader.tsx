import type React from "react";
import { cn } from "../../lib/cn";

interface ProgressLoaderProps {
  active?: boolean;
  className?: string;
}

/**
 * Hairline indeterminate progress bar, meant to sit on the edge of a panel
 * that is refreshing. It keeps its space when idle so nothing shifts.
 */
const ProgressLoader: React.FC<ProgressLoaderProps> = ({ active = false, className = "" }) => (
  <div
    className={cn(
      "h-px w-full overflow-hidden transition-opacity duration-150",
      active ? "opacity-100" : "opacity-0",
      className,
    )}
  >
    <div className="h-full w-full rounded-full bg-accent-inverse animate-progress" />
  </div>
);

export default ProgressLoader;
