/**
 * One status ladder for every place a session's state is shown: sidebar rows,
 * Home cards, the session header, the palette, parent roll-ups. Most urgent
 * first; a row shows only its top rung.
 */
export type SessionStatus = "needs-approval" | "needs-answer" | "failed" | "working" | "waiting" | "done" | "idle";
export declare const SESSION_STATUS_ORDER: readonly SessionStatus[];
export declare const SESSION_STATUS_LABEL: Record<SessionStatus, string>;
export interface SessionStatusFacts {
    pendingPermissions?: number;
    pendingQuestions?: number;
    /** Last run failed and the user has not opened it since. */
    failedUnseen?: boolean;
    running?: boolean;
    /** Idle itself, but at least one child is working. */
    childrenRunning?: boolean;
    /** Finished (or a heartbeat produced news) since the user last looked. */
    attention?: boolean;
}
export declare function sessionStatus(facts: SessionStatusFacts): SessionStatus;
/** The most urgent of several statuses (a parent's roll-up of its children). */
export declare function mostUrgent(statuses: Iterable<SessionStatus>): SessionStatus;
/** Statuses that belong in Home's "Needs you" group. */
export declare function needsYou(status: SessionStatus): boolean;
