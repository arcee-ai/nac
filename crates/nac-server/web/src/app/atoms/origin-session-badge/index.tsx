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

const KIND_FROM_ORIGIN: Record<string, OriginSessionKind> = {
  fork: OriginSessionKind.Fork,
  converted: OriginSessionKind.Converted,
  delegated: OriginSessionKind.Delegated,
  "delegated-locked": OriginSessionKind.DelegatedLocked,
};

/** Origin chip for a session origin other than the user-created default. */
export function originKindFromOrigin(
  origin: string | undefined,
): OriginSessionKind | undefined {
  return origin ? KIND_FROM_ORIGIN[origin] : undefined;
}

interface OriginSessionBadgeProps {
  kind: OriginSessionKind;
  className?: string;
}

/**
 * 16px origin chip (Figma OriginSessionBadge). Fork / Converted / Delegated
 * sit on the sublevel surface; a locked delegation inverts to the primary
 * button fill.
 */
const OriginSessionBadge: React.FC<OriginSessionBadgeProps> = ({
  kind,
  className = "",
}) => {
  const locked = kind === OriginSessionKind.DelegatedLocked;

  return (
    <div
      className={cn(
        "flex size-4 shrink-0 items-center justify-center overflow-clip rounded-[4px] shadow-md",
        locked
          ? "bg-btn-primary text-btn-primary"
          : "bg-elevation-sublevel-variant-B text-basic-tertiary",
        className,
      )}
      aria-hidden
    >
      <Icon iconName={KIND_ICON[kind]} size={12} />
    </div>
  );
};

export default OriginSessionBadge;
