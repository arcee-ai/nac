export type CommandSurface = "palette" | "shortcuts" | null;
/** Commands and sidebar ownership never cross a presentation lifetime. */
export declare function createCommandSurfaceStore(): {
    openCommandPalette: () => void;
    openShortcutSheet: () => void;
    closeCommandSurfaces: () => void;
    useCommandSurface: () => CommandSurface;
    useSidebarToggleAvailable: () => boolean;
    registerSidebarToggle(handler: () => void): () => void;
    requestSidebarToggle(): boolean;
    release(): void;
};
export declare const standaloneCommandSurfaceStore: {
    openCommandPalette: () => void;
    openShortcutSheet: () => void;
    closeCommandSurfaces: () => void;
    useCommandSurface: () => CommandSurface;
    useSidebarToggleAvailable: () => boolean;
    registerSidebarToggle(handler: () => void): () => void;
    requestSidebarToggle(): boolean;
    release(): void;
};
