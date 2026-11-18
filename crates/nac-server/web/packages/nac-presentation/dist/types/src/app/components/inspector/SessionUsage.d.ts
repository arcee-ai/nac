interface UsageReadingsProps {
    context: string;
    /** How much of the model's window the context fills, when that is known. */
    contextShare: string | null;
    input: string;
    output: string;
    /** Cache reads, listed only when the provider reported any. */
    cacheRead?: string | null;
    cost: string;
    speedTierChargesExcluded?: boolean;
    subscriptionEstimate?: boolean;
    running: boolean;
    startedAt: number | null;
    /** The last finished response, shown while nothing runs. */
    lastElapsedMs: number | null;
    /** Where the session runs, for a screen with no header to say it. */
    environment?: string | null;
}
/**
 * The token, cost and time readings as a quiet two-column list: the session
 * menu's Usage section. The run clock lives here, so a running session
 * re-renders this list every second rather than the menu around it.
 */
export declare function SessionUsageReadings(props: UsageReadingsProps): import("react").JSX.Element;
/**
 * The Usage button and the readings it opens, as a bare glyph in the phone
 * composer. The session header shows the same readings in its menu.
 */
export declare function SessionUsage({ compact, ...props }: UsageReadingsProps & {
    /** The bare glyph rather than the labelled button. */
    compact?: boolean;
}): import("react").JSX.Element;
export {};
