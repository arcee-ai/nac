/**
 * The Usage button and the token, cost and time readings it opens: in the
 * session header, and as a bare glyph in the phone composer, which has no
 * header. The run clock lives here rather than in either bar, so a running
 * session re-renders this button every second instead of the whole bar.
 */
export declare function SessionUsage({ context, contextShare, input, output, cacheRead, cost, running, startedAt, lastElapsedMs, environment, compact, }: {
    context: string;
    /** How much of the model's window the context fills, when that is known. */
    contextShare: string | null;
    input: string;
    output: string;
    /** Cache reads, listed only when the provider reported any. */
    cacheRead?: string | null;
    cost: string;
    running: boolean;
    startedAt: number | null;
    /** The last finished response, shown while nothing runs. */
    lastElapsedMs: number | null;
    /** Where the session runs, for a screen with no header to say it. */
    environment?: string | null;
    /** The bare glyph rather than the labelled header button. */
    compact?: boolean;
}): import("react").JSX.Element;
