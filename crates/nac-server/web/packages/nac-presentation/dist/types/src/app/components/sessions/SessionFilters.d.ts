import type React from "react";
import type { ManagedSessionSummary } from "../../types/api";
export declare function SessionFilters({ sessions, showSearch, mobile, sidebar, onChange, }: {
    sessions: ManagedSessionSummary[];
    /** Off where the page already carries the search field, e.g. on a phone. */
    showSearch?: boolean;
    /** Stacked fields and touch-sized chips, for the phone's filters dialog. */
    mobile?: boolean;
    /** Compact rows for the All Projects sidebar. Search stays in the nav above. */
    sidebar?: boolean;
    /** Runs after any filter moves. The phone's dialog closes on it. */
    onChange?: () => void;
}): React.JSX.Element;
