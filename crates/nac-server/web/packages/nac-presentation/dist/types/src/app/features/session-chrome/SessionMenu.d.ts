import type { SessionDrawerControls } from "./useSessionDrawer";
import type { SessionFacts } from "./useSessionFacts";
import type { ManagedSessionSummary, SessionSnapshotResponse } from "../../types/api";
/**
 * The trigger and its panel. Desktop: a 28px ⋯ chip at the end of the pills,
 * opening a popover. Phone: the header's one "panels" button, opening the
 * same content as a bottom sheet with the panel list on top.
 */
export declare function SessionMenu(props: {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    entry: ManagedSessionSummary | null;
    facts: SessionFacts;
    drawer: SessionDrawerControls;
}): import("react").JSX.Element;
