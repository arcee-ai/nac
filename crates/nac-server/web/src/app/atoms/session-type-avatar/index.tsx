import type React from "react";

import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";
import OriginSessionBadge, { OriginSessionKind } from "../origin-session-badge";

export enum SessionType {
  Agent = "agent",
  Orchestrator = "orchestrator",
}

export enum SessionOrigin {
  User = "user",
  Fork = "fork",
  Converted = "converted",
  Delegated = "delegated",
  DelegatedLocked = "delegated-locked",
}

const ORIGIN_KIND: Partial<Record<SessionOrigin, OriginSessionKind>> = {
  [SessionOrigin.Fork]: OriginSessionKind.Fork,
  [SessionOrigin.Converted]: OriginSessionKind.Converted,
  [SessionOrigin.Delegated]: OriginSessionKind.Delegated,
  [SessionOrigin.DelegatedLocked]: OriginSessionKind.DelegatedLocked,
};

interface SessionTypeAvatarProps {
  sessionType?: `${SessionType}`;
  origin?: `${SessionOrigin}`;
  /** Figma SessionAvatar state=Active: running shimmer over the chip. */
  running?: boolean;
  className?: string;
}

/**
 * 28px session-type mark (Figma SessionAvatar). Agent is violet + plane;
 * Orchestrator is teal + the orchestrator glyph. An origin other than User
 * pins OriginSessionBadge to the bottom-right and shrinks the type icon.
 */
const SessionTypeAvatar: React.FC<SessionTypeAvatarProps> = ({
  sessionType = SessionType.Agent,
  origin = SessionOrigin.User,
  running = false,
  className = "",
}) => {
  const originKind = ORIGIN_KIND[origin];
  const agent = sessionType === SessionType.Agent;

  return (
    <div
      className={cn(
        "relative flex size-[28px] overflow-clip rounded-[4px] p-[2px] shadow-convex",
        agent ? "bg-session-agent" : "bg-session-orchestrator",
        originKind ? "items-start" : "items-center justify-center",
        className,
      )}
      aria-hidden
    >
      <Icon
        iconName={agent ? IconName.Plane : IconName.Orchestrator}
        size={originKind ? 16 : 20}
        className={`${originKind ? "opacity-50" : ""} shrink-0 text-session-type`}
      />
      {originKind ? (
        <OriginSessionBadge
          sessionType={sessionType}
          kind={originKind}
          className="absolute right-0 bottom-0"
        />
      ) : null}
      {running ? (
        <span
          aria-hidden
          className="session-type-avatar-shimmer pointer-events-none absolute inset-0 rounded-[4px]"
        />
      ) : null}
    </div>
  );
};

export default SessionTypeAvatar;
