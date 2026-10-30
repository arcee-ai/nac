import type React from "react";
interface ForkSessionItemProps {
    /** Fork session id, shown shortened under the title. */
    sessionId: string;
    title?: string | null;
    deleted?: boolean;
    /** Opens the live fork. Ignored when the fork session is gone. */
    onOpen?: () => void;
    /** Removes a deleted-state marker from the original chat. */
    onDismiss?: () => void;
}
/**
 * Marker under a model turn on the chat that was forked from. Live cards open
 * the fork; a deleted card stays until the user dismisses it.
 */
declare const ForkSessionItem: React.FC<ForkSessionItemProps>;
export default ForkSessionItem;
