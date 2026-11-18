import { type SessionPanel } from "../../lib/routes";
import type { ManagedSessionSummary, SessionSnapshotResponse } from "../../types/api";
/**
 * The session header: 52px, quiet, one row. The title with its status dot and
 * one muted line of where it runs; then the Session menu, for every panel,
 * detail and action (a dot on it when something is live), and the panel
 * toggle. On a phone it is the screen's own top bar: back, title, and the
 * Session menu, which opens the panels there.
 */
export declare function TopSingleSessionHeader({ sessionId, snapshot, entry, panel, }: {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    entry: ManagedSessionSummary | null;
    /** The panel the route has open, after the behavior policy corrected it. */
    panel?: SessionPanel;
}): import("react").JSX.Element;
