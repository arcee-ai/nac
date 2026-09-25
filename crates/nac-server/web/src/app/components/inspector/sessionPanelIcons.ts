import { IconName } from "@/app/atoms/icon";
import type { SessionPanel } from "@/app/lib/routes";

export const PANEL_ICON: Record<SessionPanel, IconName> = {
  sessions: IconName.Chat,
  threads: IconName.Flow,
  delegated: IconName.Robot,
  files: IconName.Folders,
  worksets: IconName.Checklist,
  history: IconName.History,
};

export function panelBadgeCount(
  name: SessionPanel,
  subagentCount: number,
  worksetCount: number,
): number {
  if (name === "delegated") return subagentCount;
  if (name === "worksets") return worksetCount;
  return 0;
}
