import React from "react";
import type { SessionSummarySnapshot } from "../types/api";
/**
 * Actions on a single chat. Creating one is a project-level action, because a
 * chat is always started inside a project — see `ProjectActionsProvider`.
 */
interface SessionActions {
    rename: (summary: SessionSummarySnapshot) => void;
    remove: (summary: SessionSummarySnapshot) => void;
    settings: (sessionId: string) => void;
    togglePin: (summary: SessionSummarySnapshot) => Promise<void>;
    stopRun: (sessionId: string) => Promise<void>;
}
/**
 * Owns the actions a session card and the inspector header share, along with
 * the two small modals they open, so both surfaces behave identically.
 */
export declare function SessionActionsProvider({ children }: {
    children: React.ReactNode;
}): React.JSX.Element;
export declare function useSessionActions(): SessionActions;
export {};
