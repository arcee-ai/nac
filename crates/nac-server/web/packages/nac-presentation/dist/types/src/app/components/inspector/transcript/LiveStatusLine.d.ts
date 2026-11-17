/**
 * The one line a running turn ends with: what it is doing right now, in a
 * shimmer, and how long the run has taken. It always takes the same height,
 * which the turn's actions take over once it ends, so nothing below it moves
 * when it comes or goes.
 */
export declare const LiveStatusLine: import("react").MemoExoticComponent<({ label, since, }: {
    label: string;
    /** Wall-clock start of the run, when known. */
    since: number | null;
}) => import("react").JSX.Element>;
