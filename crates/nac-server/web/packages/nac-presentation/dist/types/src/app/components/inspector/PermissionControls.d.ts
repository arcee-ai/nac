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
    /** Controlled sheet visibility, for a host whose attention card opens it too. */
    sheetOpen?: boolean;
    onSheetOpenChange?: (open: boolean) => void;
    /** The request a host's "Review all" asked the sheet to show first. */
    focusRequestKey?: string | null;
}
/**
 * The quiet permission-mode chip under the composer and the sheet it opens:
 * pending requests with their full decision, approval mode, automatic
 * reviews, and remembered grants. The sheet never opens by itself; requests
 * surface in the attention card above the composer instead.
 */
export declare function PermissionControls({ sessionId, behavior, label, autoApprovalAvailable, requesterLabel, retryParentSessionId, poll, compact, sheetOpen, onSheetOpenChange, focusRequestKey, }: PermissionControlsProps): import("react").JSX.Element | null;
export {};
