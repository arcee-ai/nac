export type SshBadgeState = "connected" | "disconnected" | "reconnect";
/**
 * Compact SSH status label for the chat bar and settings header. Connected is
 * quiet cyan; a break shows the warning glyph, and reconnect adds a refresh.
 */
export declare function SshBadge({ state, onReconnect, className, }: {
    state: SshBadgeState;
    onReconnect?: () => void;
    className?: string;
}): import("react").JSX.Element;
