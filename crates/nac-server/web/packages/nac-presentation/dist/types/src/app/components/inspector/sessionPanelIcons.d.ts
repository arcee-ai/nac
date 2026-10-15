import { IconName } from "../../atoms/icon/index.js";
import type { SessionPanel } from "../../lib/routes.js";
export declare const PANEL_ICON: Record<SessionPanel, IconName>;
export declare function panelBadgeCount(name: SessionPanel, subagentCount: number, worksetCount: number): number;
