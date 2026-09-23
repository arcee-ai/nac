import type React from "react";

import { cn } from "@/app/lib/cn";
import type { SessionLineage } from "@/app/types/api";

import Icon, { IconName } from "../icon";

export const OriginSessionKind = {
  Fork: "fork",
  TraditionalChild: "traditional-child",
  ManagedOrchestrator: "managed-orchestrator",
} as const;

export type OriginSessionKind =
  | (typeof OriginSessionKind)[keyof typeof OriginSessionKind]
  | SessionLineage["kind"];

const KIND_ICON = {
  [OriginSessionKind.Fork]: IconName.Scheme,
  [OriginSessionKind.TraditionalChild]: IconName.Bolt,
  [OriginSessionKind.ManagedOrchestrator]: IconName.Lock,
} satisfies Record<OriginSessionKind, IconName>;

/** Maps every current session origin to its compact badge glyph. */
export function originSessionIconName(kind: OriginSessionKind): IconName {
  return KIND_ICON[kind];
}

/** Resolve current lineage first, then the independent fork relationship. */
export function originKindFromLineage(
  lineageKind: SessionLineage["kind"] | null | undefined,
  forked = false,
): OriginSessionKind | undefined {
  return lineageKind ?? (forked ? OriginSessionKind.Fork : undefined);
}

interface OriginSessionBadgeProps {
  kind: OriginSessionKind;
  className?: string;
}

/**
 * Compact origin mark for forks and parent-owned delegated transcripts. The
 * managed-orchestrator variant is locked because current lineage is read-only.
 */
const OriginSessionBadge: React.FC<OriginSessionBadgeProps> = ({ kind, className = "" }) => {
  const locked = kind === OriginSessionKind.ManagedOrchestrator;

  return (
    <div
      className={cn(
        "flex size-4 shrink-0 items-center justify-center overflow-clip rounded-[4px] shadow-md",
        locked
          ? "bg-btn-primary text-btn-primary"
          : "bg-elevation-sublevel-variant-B text-basic-tertiary",
        className,
      )}
      data-session-origin-kind={kind}
      aria-hidden
    >
      <Icon iconName={originSessionIconName(kind)} size={12} />
    </div>
  );
};

export default OriginSessionBadge;
