/**
 * The sidebar's destinations: the same dialogs the header already opens, plus
 * a new session in the project on screen (or a new project when none is).
 */
export declare function useSidebarCommands(): {
    projectId: string | null;
    sessionId: string | null;
    activeMcp: number;
    sshCount: number;
    mcpLabel: string;
    newSession: () => void;
    newProject: () => void;
    createLabel: string;
    openProjects: () => void | Promise<void>;
    openMcp: () => void;
    openSsh: () => void;
    openConfigurations: () => void;
    openManaged: () => void;
    modals: import("react").JSX.Element;
};
export type SidebarCommands = ReturnType<typeof useSidebarCommands>;
