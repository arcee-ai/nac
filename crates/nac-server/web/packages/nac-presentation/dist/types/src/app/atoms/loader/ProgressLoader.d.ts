import type React from "react";
interface ProgressLoaderProps {
    active?: boolean;
    className?: string;
}
/**
 * Hairline indeterminate progress bar, meant to sit on the edge of a panel
 * that is refreshing. It keeps its space when idle so nothing shifts.
 */
declare const ProgressLoader: React.FC<ProgressLoaderProps>;
export default ProgressLoader;
