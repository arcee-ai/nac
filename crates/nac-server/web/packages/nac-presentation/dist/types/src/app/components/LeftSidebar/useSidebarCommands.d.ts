/**
 * The one New session action that the sidebar, the shortcut, the palette and
 * the native menu share: Home's composer for the project on screen, focused.
 * It never creates a session or a project. Returns false while the screen's
 * project cannot be known yet.
 */
export declare function useNewSession(): {
    projectId: string | null;
    sessionId: string | null;
    newSession: () => boolean;
};
/** The desktop command contract and the sidebar's destinations. */
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
    openSettings: (section?: import("../../lib/routes").SettingsSection) => void;
    inspectProduct: () => void;
    openManaged: () => void;
};
export type SidebarCommands = ReturnType<typeof useSidebarCommands>;
