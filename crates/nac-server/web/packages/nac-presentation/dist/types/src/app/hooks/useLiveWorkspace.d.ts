/**
 * Keep the workspace views following a run that is still in progress.
 *
 * The diff endpoint reads the live working tree, but nothing invalidated it
 * between runs, so an hour-long run showed the checkout as it stood when the
 * panel was opened. Only the queries something is actually watching refetch,
 * which is why this can be driven straight off the event stream.
 *
 * A revision is a frozen commit and never needs any of this.
 */
export declare function useLiveWorkspace(sessionId: string, revision: number | null): void;
