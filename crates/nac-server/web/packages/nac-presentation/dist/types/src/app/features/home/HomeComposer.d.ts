import type { ManagedSessionSummary, ProjectRecord } from "../../types/api";
/**
 * Home's hero composer — the app's one new-session flow. Chips pick the
 * project, model and (on a Git source) an
 * isolated checkout; sending creates the session with the prompt as its
 * first message and opens it.
 */
export declare function HomeComposer({ projects, sessions, compact, }: {
    projects: readonly ProjectRecord[];
    sessions: readonly ManagedSessionSummary[];
    /** Phones: no hero heading spacing. */
    compact?: boolean;
}): import("react").JSX.Element;
