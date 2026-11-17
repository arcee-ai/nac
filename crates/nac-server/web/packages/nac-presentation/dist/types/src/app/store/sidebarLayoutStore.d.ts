/** How the sidebar groups sessions. */
export type SidebarOrganize = "project" | "status";
/** The sidebar list: the Inbox (what needs you) or the project tree. */
export type SidebarView = "inbox" | "sessions";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
/**
 * One presentation lifetime; hosted preferences are ephemeral.
 *
 * Other surfaces (e.g. the session header's sidebar toggle) should use the
 * `useSidebar()` hook or `<SidebarToggle />` from `features/sidebar`, which
 * resolve the width mode. The raw methods are `useColumnOpen`/`setColumnOpen`
 * (wide column) and `useOverlayOpen`/`setOverlayOpen` (narrow slide-over).
 */
export declare function createSidebarLayoutStore(storage?: PreferenceStorage): {
    release: () => void;
    storedOpen: () => boolean | null;
    storeOpen: (value: boolean) => void;
    setSidebarOffset: (offset: number) => void;
    useSidebarOffset: () => number;
    setColumnOpen: (value: boolean) => void;
    useColumnOpen: () => boolean | null;
    setOverlayOpen: (value: boolean) => void;
    useOverlayOpen: () => boolean;
    setOrganize: (value: SidebarOrganize) => void;
    useOrganize: () => SidebarOrganize;
    setView: (value: SidebarView) => void;
    useView: () => SidebarView;
    toggleProjectCollapsed: (projectId: string) => void;
    useCollapsedProjects: () => readonly string[];
    toggleParentExpanded: (sessionId: string) => void;
    useExpandedParents: () => readonly string[];
    revealGroup: (groupId: string) => void;
    useRevealedGroups: () => readonly string[];
};
export declare const release: () => void, storedOpen: () => boolean | null, storeOpen: (value: boolean) => void, setSidebarOffset: (offset: number) => void, useSidebarOffset: () => number, setColumnOpen: (value: boolean) => void, useColumnOpen: () => boolean | null, setOverlayOpen: (value: boolean) => void, useOverlayOpen: () => boolean, setOrganize: (value: SidebarOrganize) => void, useOrganize: () => SidebarOrganize, setView: (value: SidebarView) => void, useView: () => SidebarView, toggleProjectCollapsed: (projectId: string) => void, useCollapsedProjects: () => readonly string[], toggleParentExpanded: (sessionId: string) => void, useExpandedParents: () => readonly string[], revealGroup: (groupId: string) => void, useRevealedGroups: () => readonly string[];
export {};
