export type SessionTargetOutcome = "opened" | "deferred" | "unavailable" | "stale";
export interface NotificationSessionTarget {
    session_id: string;
    occurrence_id: string;
}
export interface DesktopSessionTargetPort {
    connectSessionTarget?(owner: (message: unknown) => Promise<SessionTargetOutcome>): () => void;
}
/** One bounded UI lookup; a newer explicit response aborts the former lookup.
 * The native document adapter owns exact profile/launch/view/document matching. */
export declare function connectSessionTargets(port: DesktopSessionTargetPort, open: (target: NotificationSessionTarget, signal: AbortSignal) => Promise<SessionTargetOutcome>): () => void;
