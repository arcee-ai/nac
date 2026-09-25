import type { ReactNode } from "react";

import { Button, ButtonContent, ButtonVariant, Icon, IconName, Tooltip } from "@/app/atoms";
import { TooltipPosition } from "@/app/atoms/tooltip";
import { PanelCountBadge } from "@/app/components/inspector/PanelCountBadge";
import { panelBadgeCount, PANEL_ICON } from "@/app/components/inspector/sessionPanelIcons";
import { SESSION_PANEL_LABEL, type SessionPanel } from "@/app/lib/routes";
import { useManagedOrchestrators, useTraditionalChildren } from "@/app/services/queries";
import type { SessionBehavior, SessionSnapshotResponse } from "@/app/types/api";

/** Icon column left behind once the right panel has slid away. Matches the left rail. */
export const RIGHT_SIDEBAR_RAIL_WIDTH = 52;

/**
 * The collapsed right sidebar: a chevron that brings the panel back, then one
 * ghost icon per wide panel. Choosing an icon opens the panel on that tab.
 */
export function RightSidebarRail({
  sessionId,
  snapshot,
  behavior,
  panels,
  onOpen,
  onSelect,
}: {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  behavior: SessionBehavior | null;
  panels: readonly SessionPanel[];
  onOpen: () => void;
  onSelect: (panel: SessionPanel) => void;
}) {
  const subagents = panels.includes("delegated");
  const children = useTraditionalChildren(sessionId, subagents);
  const orchestrators = useManagedOrchestrators(
    sessionId,
    subagents && behavior === "direct-with-orchestrator",
  );
  const subagentCount = (children.data?.length ?? 0) + (orchestrators.data?.length ?? 0);
  const worksetCount = snapshot?.worksets?.items.length ?? 0;

  return (
    <div
      className="flex h-full flex-col items-center p-2"
      style={{ width: RIGHT_SIDEBAR_RAIL_WIDTH }}
    >
      <div className="flex flex-col items-center gap-4 [&>*]:shrink-0">
        <RailButton label="Show panel" onClick={onOpen}>
          <Icon iconName={IconName.SidebarChevronLeft} />
        </RailButton>
        <div className="flex flex-col items-center gap-4">
          {panels.map((name) => {
            const badge = panelBadgeCount(name, subagentCount, worksetCount);
            return (
              <span key={name} className="relative">
                <RailButton label={SESSION_PANEL_LABEL[name]} onClick={() => onSelect(name)}>
                  <Icon iconName={PANEL_ICON[name]} />
                </RailButton>
                {badge > 0 ? <PanelCountBadge count={badge} /> : null}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RailButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip title={label} position={TooltipPosition.CenterLeft} sticky>
      <Button
        variant={ButtonVariant.Ghost}
        content={ButtonContent.Icon}
        aria-label={label}
        onClick={onClick}
      >
        {children}
      </Button>
    </Tooltip>
  );
}
