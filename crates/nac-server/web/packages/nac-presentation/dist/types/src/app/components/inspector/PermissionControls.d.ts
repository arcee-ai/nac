import type { SessionBehavior } from "../../types/api";
interface PermissionControlsProps {
    sessionId: string;
    behavior: SessionBehavior | null;
    label?: string;
    autoApprovalAvailable?: boolean;
    requesterLabel?: string;
}
/** Direct-session permission prompt and remembered-grant manager. */
export declare function PermissionControls({ sessionId, behavior, label, autoApprovalAvailable, requesterLabel, }: PermissionControlsProps): import("react").JSX.Element | null;
export {};
