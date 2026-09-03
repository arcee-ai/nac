import type React from "react";

import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";

export enum SessionType {
  Agent = "agent",
  AgentWithOrchestrator = "agent-with-orchestrator",
  Orchestrator = "orchestrator",
}

export enum SessionOrigin {
  User = "user",
  Fork = "fork",
  Converted = "converted",
  Delegated = "delegated",
  DelegatedLocked = "delegated-locked",
}

/** Plane for Agent, plane-add for Agent + Orchestrator, orchestrator glyph otherwise. */
export function sessionTypeIconName(sessionType: `${SessionType}` = SessionType.Agent): IconName {
  if (sessionType === SessionType.Orchestrator) return IconName.Orchestrator;
  if (sessionType === SessionType.AgentWithOrchestrator) return IconName.PlaneAdd;
  return IconName.Plane;
}

interface SessionTypeAvatarProps {
  sessionType?: `${SessionType}`;
  /** Figma SessionAvatar state=Active: running shimmer over the chip. */
  running?: boolean;
  className?: string;
}

/**
 * 28px session-type mark (Figma SessionAvatar). Neutral gray chip; Agent is
 * plane, Agent + Orchestrator is plane-add, Orchestrator is the orchestrator
 * glyph. Origin lives on OriginSessionBadge beside the title, not on this mark.
 */
const SessionTypeAvatar: React.FC<SessionTypeAvatarProps> = ({
  sessionType = SessionType.Agent,
  running = false,
  className = "",
}) => (
  <div
    className={cn(
      "relative flex size-[28px] items-center justify-center overflow-clip rounded-[4px] p-[2px] shadow-convex bg-[var(--gray-600)]",
      className,
    )}
    aria-hidden
  >
    <Icon
      iconName={sessionTypeIconName(sessionType)}
      size={20}
      className="shrink-0"
      color="var(--color-fill-basic-primary)"
    />
    {running ? (
      <span
        aria-hidden
        className="session-type-avatar-shimmer pointer-events-none absolute inset-0 rounded-[4px]"
      />
    ) : null}
  </div>
);

export default SessionTypeAvatar;
