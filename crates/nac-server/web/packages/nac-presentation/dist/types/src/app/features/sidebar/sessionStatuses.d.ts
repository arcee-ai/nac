import { type SessionStatus } from "../../lib/sessionStatus";
import type { ManagedSessionSummary } from "../../types/api";
export interface SessionStatusIndex {
    /** A session's own rung. */
    own: (sessionId: string) => SessionStatus;
    /** Its own rung, raised to any descendant's rung that needs the user. */
    rolled: (sessionId: string) => SessionStatus;
}
/**
 * One status ladder over the whole session list: live runs, pending
 * approvals, finished-and-unseen (the attention store), and children working
 * while their parent waits.
 */
export declare function useSessionStatuses(sessions: readonly ManagedSessionSummary[]): SessionStatusIndex;
