import type { ThreadLogLine } from "../../lib/threadLog";
/**
 * The newest lines of a thread's log, bottom-aligned and clipped to whatever
 * height the caller gives it, so the tail reads the way a terminal does: the
 * newest command arrives at the bottom edge and the older ones fade out above.
 */
export declare function ThreadLogTail({ lines, className, }: {
    lines: ThreadLogLine[];
    className?: string;
}): import("react").JSX.Element;
