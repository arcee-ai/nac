import type React from "react";
interface ShimmerLoaderProps {
    /** Number of placeholder rows. */
    rows?: number;
    className?: string;
    rowClassName?: string;
}
/** Skeleton rows for content whose shape is known before the data arrives. */
declare const ShimmerLoader: React.FC<ShimmerLoaderProps>;
export default ShimmerLoader;
