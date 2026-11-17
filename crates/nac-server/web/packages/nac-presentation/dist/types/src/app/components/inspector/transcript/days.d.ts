/** The local calendar day a store timestamp falls on, or null when it has none. */
export declare function dayKey(value: string | null | undefined): number | null;
/** "Today", "Yesterday", "Mon 14 Nov", or "14 Nov 2025" for another year. English, like the message dates. */
export declare function dayLabel(day: number, now?: number): string;
