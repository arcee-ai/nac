import type { SessionStatusIndex } from "../sidebar/sessionStatuses";
import type { ManagedSessionSummary, ProjectRecord } from "../../types/api";
export declare function SectionHeading({ children, trailing, }: {
    children: string;
    trailing?: React.ReactNode;
}): import("react").JSX.Element;
/**
 * Home's live groups — "Needs you" then "Running", each only when non-empty —
 * and the quiet "Recent" list.
 */
export declare function HomeActivity({ sessions, projects, statuses, }: {
    sessions: readonly ManagedSessionSummary[];
    projects: readonly ProjectRecord[];
    statuses: SessionStatusIndex;
}): import("react").JSX.Element;
