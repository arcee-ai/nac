/** Compact, tabular-friendly age: "now", "4m", "3h", "2d", then "Mar 4". */
export declare function compactAge(storeTime: string | null | undefined, now: number): string;
/** Spoken form of the same age, for titles and assistive technology. */
export declare function longAge(storeTime: string | null | undefined): string;
