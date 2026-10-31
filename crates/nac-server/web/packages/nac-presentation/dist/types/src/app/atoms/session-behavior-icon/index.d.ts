import type React from "react";
import type { SessionBehavior, SessionLineage } from "../../types/api";
export declare enum SessionBehaviorIconSize {
    Small = "small",
    Medium = "medium",
    Large = "large"
}
interface SessionBehaviorIconProps {
    behavior: SessionBehavior | null | undefined;
    /** A delegated session's relationship, which decides over its behavior. */
    lineage?: SessionLineage["kind"] | null;
    size?: SessionBehaviorIconSize;
    className?: string;
}
/**
 * The session type as a glyph: a plane for a direct agent, a plane with a plus
 * for a direct agent that can launch orchestrators, and the orchestrator graph
 * otherwise. It always draws; callers decide visibility with
 * `useSessionBehaviorIconVisible`.
 *
 * Decorative: the parent's accessible name carries the type. Its states use the
 * `fill-btn-secondary*` tokens: inside a `.btn` the button stylesheet colors it,
 * elsewhere the caller sets them as its color (`text-fill-…`). Without either
 * the glyph draws in `currentColor`.
 */
declare const SessionBehaviorIcon: React.FC<SessionBehaviorIconProps>;
export default SessionBehaviorIcon;
