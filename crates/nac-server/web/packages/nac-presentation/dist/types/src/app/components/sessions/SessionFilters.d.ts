import type { ManagedSessionSummary } from "../../types/api";
/**
 * The All Projects sort and facet filters, for the desktop sidebar and the
 * phone menu. Search stays in the navigation above them.
 */
export declare function SessionFilters({ sessions, inset, }: {
    sessions: ManagedSessionSummary[];
    /** Rows indented 12px past the rules between them, as the phone menu has them. */
    inset?: boolean;
}): import("react").JSX.Element;
