/**
 * The ⌘K palette and the ⌘/ shortcut sheet are opened from many places (the
 * sidebar's Search pill, the mobile header, keyboard). This tiny signal is
 * the shared switch; the palette owner renders the UI.
 */
type Surface = "palette" | "shortcuts" | null;
export declare function openCommandPalette(): void;
export declare function openShortcutSheet(): void;
export declare function closeCommandSurfaces(): void;
export declare function useCommandSurface(): Surface;
export declare function registerSidebarToggle(handler: () => void): () => void;
/** Asks the mounted sidebar to toggle. False when no sidebar is on screen. */
export declare function requestSidebarToggle(): boolean;
export declare function useSidebarToggleAvailable(): boolean;
/** For the sidebar: answer palette "Toggle sidebar" requests while mounted. */
export declare function useSidebarToggleRequests(handler: (() => void) | null): void;
export {};
