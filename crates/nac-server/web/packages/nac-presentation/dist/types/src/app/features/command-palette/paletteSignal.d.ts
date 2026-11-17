/** Compatibility controls for standalone fixtures. Production resolves its runtime. */
export declare const openCommandPalette: () => void, openShortcutSheet: () => void, closeCommandSurfaces: () => void;
export declare function useCommandSurfaceControls(): {
    openCommandPalette: () => void;
    openShortcutSheet: () => void;
    closeCommandSurfaces: () => void;
    useCommandSurface: () => import("./commandSurfaceStore").CommandSurface;
    useSidebarToggleAvailable: () => boolean;
    registerSidebarToggle(handler: () => void): () => void;
    requestSidebarToggle(): boolean;
    release(): void;
};
export declare function useSidebarToggleRequests(handler: (() => void) | null): void;
