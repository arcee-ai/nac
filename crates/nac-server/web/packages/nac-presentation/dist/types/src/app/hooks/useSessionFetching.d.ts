/**
 * Whether anything belonging to this session is being fetched right now — the
 * snapshot, the file listing, a diff, the revisions — reported as something
 * worth showing rather than as raw query state.
 *
 * Every session-scoped key starts `["session", id]`, so one filter covers the
 * whole panel however its parts are split up. The event stream can invalidate
 * several of those at once, hence the smoothing: the point is to say "this is
 * refreshing", not to strobe once per request.
 */
export declare function useSessionFetching(sessionId: string): boolean;
