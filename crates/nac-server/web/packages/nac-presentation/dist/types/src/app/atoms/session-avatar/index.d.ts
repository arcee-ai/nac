import type React from "react";
export declare function sessionAvatarColor(id: string | undefined): string;
interface SessionAvatarProps extends React.SVGProps<SVGSVGElement> {
    id: string | undefined;
    size?: number;
    /** Pulses the avatar while the session has a run going. */
    isRunning?: boolean;
}
/**
 * Deterministic 6x6 identicon for a session. Strokes sit centred on the cell
 * boundary, matching the Figma component, so neighbouring cells share one line
 * rather than stacking two; the viewBox is padded by half a stroke so the outer
 * ring is not clipped.
 */
declare const SessionAvatar: React.FC<SessionAvatarProps>;
export default SessionAvatar;
