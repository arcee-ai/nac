import type { SessionBehavior } from "../../types/api";
interface PermissionControlsProps {
    sessionId: string;
    behavior: SessionBehavior | null;
    label?: string;
    autoApprovalAvailable?: boolean;
    requesterLabel?: string;
    /** Child retries use its owning primary; mode remains inherited. */
    retryParentSessionId?: string;
    poll?: boolean;
    /** The trigger drops its mode label but keeps any pending count; its accessible name stays. */
    compact?: boolean;
}
/** Direct-session permission prompt and remembered-grant manager. */
export declare function PermissionControls({ sessionId, behavior, label, autoApprovalAvailable, requesterLabel, retryParentSessionId, poll, compact, }: PermissionControlsProps): import("react").JSX.Element | null;
export {};
