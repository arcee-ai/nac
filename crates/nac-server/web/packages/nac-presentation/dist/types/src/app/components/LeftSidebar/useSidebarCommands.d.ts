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
