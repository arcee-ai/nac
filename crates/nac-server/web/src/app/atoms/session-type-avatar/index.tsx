import type React from "react";

import { cn } from "@/app/lib/cn";
import type { SessionBehavior } from "@/app/types/api";

import Icon, { IconName } from "../icon";

const SESSION_BEHAVIOR_ICON = {
  orchestrator: IconName.Orchestrator,
  direct: IconName.Plane,
  "direct-with-orchestrator": IconName.PlaneAdd,
} satisfies Record<SessionBehavior, IconName>;

/** Maps every immutable NAC session behavior to its session identity glyph. */
export function sessionTypeIconName(behavior: SessionBehavior = "orchestrator"): IconName {
  return SESSION_BEHAVIOR_ICON[behavior];
}

interface SessionTypeAvatarProps {
  behavior?: SessionBehavior;
  /** Figma SessionAvatar state=Active: running shimmer over the chip. */
  running?: boolean;
  className?: string;
}

/**
 * Compact identity mark for the immutable session behavior. Legacy sessions
 * that omit behavior keep the product default and render as orchestrators.
 */
const SessionTypeAvatar: React.FC<SessionTypeAvatarProps> = ({
  behavior = "orchestrator",
  running = false,
  className = "",
}) => (
  <div
    className={cn(
      "relative flex size-[28px] items-center justify-center overflow-clip rounded-[4px] bg-[var(--gray-600)] p-[2px] shadow-convex",
      running && "session-type-avatar-shimmer",
      className,
    )}
    aria-hidden
  >
    <Icon
      iconName={sessionTypeIconName(behavior)}
      size={20}
      className="shrink-0"
      color="var(--color-fill-basic-primary)"
    />
  </div>
);

export default SessionTypeAvatar;
