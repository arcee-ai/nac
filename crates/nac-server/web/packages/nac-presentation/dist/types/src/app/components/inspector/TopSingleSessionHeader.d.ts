import { type SessionPanel } from "../../lib/routes";
import type { ManagedSessionSummary, SessionSnapshotResponse } from "../../types/api";
/**
 * The session header: 52px, quiet, one row. The title with its status dot and
 * one muted line of where it runs; then only the pills that have something to
 * say, and ⋯ for the rest. On a phone it is the screen's own top bar: back,
 * title, and one button for every panel and action.
 */
export declare function TopSingleSessionHeader({ sessionId, snapshot, entry, panel, }: {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    entry: ManagedSessionSummary | null;
    /** The panel the route has open, after the behavior policy corrected it. */
    panel?: SessionPanel;
}): import("react").JSX.Element;
