import { type ReactNode } from "react";
/**
 * Wrap a subtree so React reports what each of its commits actually cost.
 * Transparent unless `__perf.on()` has been called, so it can stay in the tree.
 */
export declare function PerfProfiler({ id, children }: {
    id: string;
    children: ReactNode;
}): import("react").JSX.Element;
