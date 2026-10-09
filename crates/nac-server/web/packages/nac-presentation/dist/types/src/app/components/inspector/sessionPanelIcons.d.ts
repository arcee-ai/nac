import { IconName } from "../../atoms/icon";
import type { SessionPanel } from "../../lib/routes";
export declare const PANEL_ICON: Record<SessionPanel, IconName>;
export declare function panelBadgeCount(name: SessionPanel, subagentCount: number, worksetCount: number): number;
