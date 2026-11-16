import { type SessionPanel } from "../../lib/routes";
import type { SessionBehavior, SessionSnapshotResponse } from "../../types/api";
/** Icon column left behind once the right panel has slid away. Matches the left rail. */
export declare const RIGHT_SIDEBAR_RAIL_WIDTH = 52;
/**
 * The collapsed right sidebar: a chevron that brings the panel back, then one
 * ghost icon per wide panel. Choosing an icon opens the panel on that tab.
 */
export declare function RightSidebarRail({ sessionId, snapshot, behavior, panels, onOpen, onSelect, }: {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    behavior: SessionBehavior | null;
    panels: readonly SessionPanel[];
    onOpen: () => void;
    onSelect: (panel: SessionPanel) => void;
}): import("react").JSX.Element;
