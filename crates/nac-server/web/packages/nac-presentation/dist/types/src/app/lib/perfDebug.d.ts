export declare function perfEnabled(): boolean;
export interface PerfOptions {
    /** Duration to fold into the tag's totals. */
    ms?: number;
    /** Numeric fields summed into the report and printed on the log line. */
    fields?: Record<string, number | string>;
    /** Minimum gap between console lines for this tag. 0 logs every call. */
    throttleMs?: number;
    /** Log even when throttled if `ms` reached this. */
    slowMs?: number;
}
/** Record one occurrence of `tag` and, subject to throttling, print it. */
export declare function perfMark(tag: string, options?: PerfOptions): void;
/**
 * Bump the epoch. Called once per incoming stream delta so every counter line
 * can be read as "how much work did delta #N cause".
 */
export declare function perfEpoch(): void;
/** Count a component render. Safe to call unconditionally: it is not a hook. */
export declare function perfRender(tag: string, throttleMs?: number): void;
/** Time a synchronous section and fold the duration into `tag`. */
export declare function perfTime<T>(tag: string, run: () => T, slowMs?: number): T;
