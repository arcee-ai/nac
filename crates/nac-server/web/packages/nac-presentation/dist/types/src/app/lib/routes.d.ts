export declare const SESSION_PANELS: readonly ["sessions", "threads", "delegated", "files", "worksets", "history"];
export type SessionPanel = (typeof SESSION_PANELS)[number];
export declare const SESSION_PANEL_LABEL: {
    sessions: string;
    threads: string;
    delegated: string;
    files: string;
    worksets: string;
    history: string;
};
/**
 * Panels the wide side box tabs between. A wide box carries the revisions in
 * its footer chip, so History is a phone-only panel of the bottom bar.
 */
export declare const WIDE_SESSION_PANELS: ("threads" | "sessions" | "worksets" | "delegated" | "files")[];
export declare const DEFAULT_SESSION_PANEL: SessionPanel;
export declare function isSessionPanel(value: string | undefined): value is SessionPanel;
export declare const routes: {
    list: () => string;
    session: (sessionId: string, panel?: SessionPanel) => string;
    /** Redirects to the project's newest session, or offers to start one. */
    project: (projectId: string) => string;
    designPreview: () => string;
};
/**
 * Session the path points at, or null on any other screen. The top bar sits in
 * the layout route, above the match that carries `:sessionId`, so it cannot
 * read the parameter from the router.
 */
export declare function sessionIdFromPath(pathname: string): string | null;
/** Project the path points at, for the same reason as `sessionIdFromPath`. */
export declare function projectIdFromPath(pathname: string): string | null;
