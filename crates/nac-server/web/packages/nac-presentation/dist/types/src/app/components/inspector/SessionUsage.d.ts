/**
 * The session header's Usage button and the token, cost and time readings it
 * opens. The run clock lives here rather than in the header, so a running
 * session re-renders this button every second instead of the whole bar.
 */
export declare function SessionUsage({ context, contextShare, input, output, cost, running, startedAt, lastElapsedMs, }: {
    context: string;
    /** How much of the model's window the context fills, when that is known. */
    contextShare: string | null;
    input: string;
    output: string;
    cost: string;
    running: boolean;
    startedAt: number | null;
    /** The last finished response, shown while nothing runs. */
    lastElapsedMs: number | null;
}): import("react").JSX.Element;
