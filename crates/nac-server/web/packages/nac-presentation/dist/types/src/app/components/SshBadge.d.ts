export type SshBadgeState = "connected" | "disconnected" | "reconnect";
/**
 * Compact SSH status label for the composer row and settings header. Connected
 * is quiet ink; a break shows the warning glyph in red, and reconnect adds a
 * refresh.
 */
export declare function SshBadge({ state, onReconnect, className, }: {
    state: SshBadgeState;
    onReconnect?: () => void;
    className?: string;
}): import("react").JSX.Element;
