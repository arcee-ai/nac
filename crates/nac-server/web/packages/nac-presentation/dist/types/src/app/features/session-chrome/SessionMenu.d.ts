import type { SessionDrawerControls } from "./useSessionDrawer";
import type { SessionFacts } from "./useSessionFacts";
import type { ManagedSessionSummary, SessionSnapshotResponse } from "../../types/api";
/** "+12 −3", each half only when it has something to count. */
export declare function ChangeCounts({ additions, deletions }: {
    additions: number;
    deletions: number;
}): import("react").JSX.Element;
/**
 * The session header's one control. Its accessible name stays "Session menu"
 * on a wide screen ("Open panel" on a phone) whatever it shows; a small ink
 * dot at its corner says something in the session's background is live
 * (running subagents, an active goal, an armed schedule), and its description
 * says what. Desktop: a 28px ⋯ chip opening a popover. Phone: a 44px button
 * opening the same content as a bottom sheet.
 */
export declare function SessionMenu(props: {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    entry: ManagedSessionSummary | null;
    facts: SessionFacts;
    drawer: SessionDrawerControls;
}): import("react").JSX.Element;
