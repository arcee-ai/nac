import type { ManagedSessionSummary, ProjectRecord } from "../../types/api";
/**
 * Home's hero composer — the app's one new-session flow. Its chips pick the
 * behavior and model; the row under it says where the session works: the
 * project, then its folder or (for a direct agent on a Git source) an isolated
 * checkout and the ref it starts from. Sending creates the session with the
 * prompt as its first message and opens it.
 */
export declare function HomeComposer({ projects, sessions, compact, }: {
    projects: readonly ProjectRecord[];
    sessions: readonly ManagedSessionSummary[];
    /** Phones: no hero heading spacing. */
    compact?: boolean;
}): import("react").JSX.Element;
