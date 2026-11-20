import { IconName } from "@/app/atoms/icon";
import type { SessionPanel } from "@/app/lib/routes";

export const PANEL_ICON: Record<SessionPanel, IconName> = {
  sessions: IconName.Chat,
  insights: IconName.Eye,
  delegated: IconName.Robot,
  files: IconName.Folders,
  terminal: IconName.Terminal,
  heartbeats: IconName.Clock,
  history: IconName.History,
};

export function panelBadgeCount(name: SessionPanel, subagentCount: number): number {
  if (name === "delegated") return subagentCount;
  return 0;
}
