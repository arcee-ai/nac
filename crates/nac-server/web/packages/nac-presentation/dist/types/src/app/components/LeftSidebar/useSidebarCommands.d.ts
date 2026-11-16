/**
 * The desktop command contract (and the sidebar's "New session"): settings
 * destinations plus a new session in the project on screen, or Home's
 * composer when no project is on screen.
 */
export declare function useSidebarCommands(): {
    projectId: string | null;
    sessionId: string | null;
    activeMcp: number;
    sshCount: number;
    mcpLabel: string;
    newSession: () => boolean;
    newProject: () => void;
    createLabel: string;
    openProjects: () => void | Promise<void>;
    openMcp: () => void;
    openSsh: () => void;
    openConfigurations: () => void;
    inspectProduct: () => void;
    openManaged: () => void;
};
export type SidebarCommands = ReturnType<typeof useSidebarCommands>;
