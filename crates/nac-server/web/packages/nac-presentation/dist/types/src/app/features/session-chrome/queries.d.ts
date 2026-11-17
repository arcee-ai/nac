/**
 * The session's interval schedules, read under the Schedules panel's own
 * inventory key so the Session menu and the panel share one cache entry. The
 * menu only needs to know whether any exist, so it refreshes at a gentle
 * cadence; the open panel keeps its own faster poll.
 */
export declare function useSessionSchedules(sessionId: string, enabled: boolean): {
    count: number;
    active: boolean;
};
