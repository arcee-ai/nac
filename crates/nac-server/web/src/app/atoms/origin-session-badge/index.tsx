import type React from "react";

import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";

export enum OriginSessionKind {
  Fork = "fork",
  Converted = "converted",
  Delegated = "delegated",
  DelegatedLocked = "delegated-locked",
}

const KIND_ICON: Record<OriginSessionKind, IconName> = {
  [OriginSessionKind.Fork]: IconName.Scheme,
  [OriginSessionKind.Converted]: IconName.TurnRight,
  [OriginSessionKind.Delegated]: IconName.Bolt,
  [OriginSessionKind.DelegatedLocked]: IconName.Lock,
};

interface OriginSessionBadgeProps {
  /** Colours the chip for the parent session type. */
  sessionType?: "agent" | "orchestrator";
  kind: OriginSessionKind;
  className?: string;
}

/**
 * 16px origin chip on a session-type avatar (Figma OriginSessionBadge).
 * Fork / Converted / Delegated sit on the saturated complementary; a locked
 * delegation uses the tinted chip and a dark lock.
 */
const OriginSessionBadge: React.FC<OriginSessionBadgeProps> = ({
  sessionType = "agent",
  kind,
  className = "",
}) => {
  const locked = kind === OriginSessionKind.DelegatedLocked;
  const agent = sessionType === "agent";

  return (
    <div
      className={cn(
        "flex size-4 items-center justify-center overflow-clip rounded-[4px] shadow-md",
        locked
          ? agent
            ? "bg-session-origin-agent-locked"
            : "bg-session-origin-orchestrator-locked"
          : agent
            ? "bg-session-origin-agent"
            : "bg-session-origin-orchestrator",
        className,
      )}
      aria-hidden
    >
      <Icon
        iconName={KIND_ICON[kind]}
        size={12}
        className={locked ? "text-session-origin-locked" : "text-session-type"}
      />
    </div>
  );
};

export default OriginSessionBadge;
