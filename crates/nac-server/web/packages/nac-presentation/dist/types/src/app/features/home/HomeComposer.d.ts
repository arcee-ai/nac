import type { ManagedSessionSummary, ProjectRecord } from "../../types/api";
/**
 * Home's hero composer — the app's one new-session flow. The strip on top says
 * where the session runs (this computer or the project's SSH host) and picks
 * the project; its settings button holds the isolated-checkout choice and ref,
 * out of the way of a plain session. The composer's chips pick the behavior and
 * model. Sending creates the session with the prompt as its first message.
 */
export declare function HomeComposer({ projects, sessions, compact, }: {
    projects: readonly ProjectRecord[];
    sessions: readonly ManagedSessionSummary[];
    /** Phones: no hero heading spacing. */
    compact?: boolean;
}): import("react").JSX.Element;
