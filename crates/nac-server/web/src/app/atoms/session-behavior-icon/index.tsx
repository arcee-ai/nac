import type React from "react";

import { cn } from "../../lib/cn";
import { sessionBehaviorIcon } from "../../lib/sessionBehavior";
import type { SessionBehavior, SessionLineage } from "../../types/api";
import Icon from "../icon";

export enum SessionBehaviorIconSize {
  Small = "small",
  Medium = "medium",
  Large = "large",
}

const ICON_PX: Record<SessionBehaviorIconSize, number> = {
  [SessionBehaviorIconSize.Small]: 16,
  [SessionBehaviorIconSize.Medium]: 20,
  [SessionBehaviorIconSize.Large]: 24,
};

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
 * `fill-btn-secondary*` tokens: inside a `.btn` the button stylesheet fills it,
 * elsewhere the parent sets them on the paths (`[&_path]:fill-…`). Without
 * either the glyph paints `currentColor`.
 */
const SessionBehaviorIcon: React.FC<SessionBehaviorIconProps> = ({
  behavior,
  lineage,
  size = SessionBehaviorIconSize.Medium,
  className,
}) => {
  const iconName = sessionBehaviorIcon(behavior, lineage);
  return (
    <Icon
      iconName={iconName}
      size={ICON_PX[size]}
      aria-hidden
      data-session-behavior-icon={iconName}
      className={cn("shrink-0", className)}
    />
  );
};

export default SessionBehaviorIcon;
