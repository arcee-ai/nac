import React from "react";
import type { ProjectRecord, SessionSummarySnapshot } from "../types/api";
interface ProjectActions {
    create: () => void;
    /** Opens New project on its SSH location. */
    createSsh: () => void;
    /**
     * Files a session that belongs to no project. Asks nothing when a project
     * already covers the session's location — there is only ever the one it can
     * go to — and opens the dialog to name a new project otherwise.
     */
    assign: (summary: SessionSummarySnapshot) => void;
    rename: (project: ProjectRecord) => void;
    remove: (project: ProjectRecord) => void;
    togglePin: (project: ProjectRecord) => Promise<void>;
    /**
     * Opens Home's composer pointed at a project: the one new-session flow. The
     * session is created when the user sends. `firstChat` is accepted for
     * existing callers (an empty project's redirect) and replaces the history
     * entry so Back does not bounce through the redirect.
     */
    newChat: (projectId: string, firstChat?: boolean) => Promise<void>;
}
/**
 * Owns the project-level actions the trail, the popovers and the project cards
 * share, along with the dialogs they open, so every surface behaves the same.
 */
export declare function ProjectActionsProvider({ children }: {
    children: React.ReactNode;
}): React.JSX.Element;
export declare function useProjectActions(): ProjectActions;
export {};
