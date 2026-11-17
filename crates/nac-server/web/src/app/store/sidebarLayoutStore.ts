import { createStore, standalonePreferenceStorage } from "@/app/lib/store";

/** How the sidebar groups sessions. */
export type SidebarOrganize = "project" | "status";
/** The sidebar list: the Inbox (what needs you) or the project tree. */
export type SidebarView = "inbox" | "sessions";

interface SidebarLayoutState {
  /** Pixels the session sidebar reserves. Zero when that sidebar is not mounted. */
  offset: number;
  /**
   * The wide (≥1024px) column's open state. Null until the user toggles, so
   * the width default applies; the choice then persists.
   */
  columnOpen: boolean | null;
  /** The narrow (768–1023px) slide-over. Never persisted; closed by default. */
  overlayOpen: boolean;
  organize: SidebarOrganize;
  view: SidebarView;
  /** Project groups the user folded away (persisted). */
  collapsedProjects: readonly string[];
  /** Parents whose subagent rows are shown (this presentation only). */
  expandedParents: readonly string[];
  /** Groups showing every row instead of the first few (this presentation only). */
  revealedGroups: readonly string[];
}

const OPEN_KEY = "nac.sidebar.open";
const ORGANIZE_KEY = "nac.sidebar.organize";
const VIEW_KEY = "nac.sidebar.view";
const COLLAPSED_KEY = "nac.sidebar.collapsed-projects";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function read(storage: PreferenceStorage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null; // Preferences are optional.
  }
}

function write(storage: PreferenceStorage | undefined, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    /* Optional. */
  }
}

function readCollapsed(storage: PreferenceStorage | undefined): string[] {
  const raw = read(storage, COLLAPSED_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string").slice(0, 500)
      : [];
  } catch {
    return [];
  }
}

function toggled(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

/**
 * One presentation lifetime; hosted preferences are ephemeral.
 *
 * Other surfaces (e.g. the session header's sidebar toggle) should use the
 * `useSidebar()` hook or `<SidebarToggle />` from `features/sidebar`, which
 * resolve the width mode. The raw methods are `useColumnOpen`/`setColumnOpen`
 * (wide column) and `useOverlayOpen`/`setOverlayOpen` (narrow slide-over).
 */
export function createSidebarLayoutStore(storage?: PreferenceStorage) {
  const storedColumn = read(storage, OPEN_KEY);
  const storedView = read(storage, VIEW_KEY);
  const initial: SidebarLayoutState = {
    offset: 0,
    columnOpen: storedColumn === "1" ? true : storedColumn === "0" ? false : null,
    overlayOpen: false,
    // The Inbox replaced "By status"; the tree is always by project now.
    organize: "project",
    view: storedView === "inbox" ? "inbox" : "sessions",
    collapsedProjects: readCollapsed(storage),
    expandedParents: [],
    revealedGroups: [],
  };
  const sidebarLayoutStore = createStore<SidebarLayoutState>(initial, "sidebar-layout");
  const { getState, setState, useStore } = sidebarLayoutStore;

  function setSidebarOffset(offset: number): void {
    setState({ offset });
  }
  function useSidebarOffset(): number {
    return useStore((state) => state.offset);
  }

  function setColumnOpen(value: boolean) {
    setState({ columnOpen: value });
    write(storage, OPEN_KEY, value ? "1" : "0");
  }
  const useColumnOpen = () => useStore((state) => state.columnOpen);

  /** Compatibility accessors for the wide preference. */
  const storedOpen = (): boolean | null => getState().columnOpen;
  const storeOpen = (value: boolean) => setColumnOpen(value);

  function setOverlayOpen(value: boolean) {
    setState({ overlayOpen: value });
  }
  const useOverlayOpen = () => useStore((state) => state.overlayOpen);

  function setOrganize(value: SidebarOrganize) {
    setState({ organize: value });
    write(storage, ORGANIZE_KEY, value);
  }
  const useOrganize = () => useStore((state) => state.organize);

  function setView(value: SidebarView) {
    setState({ view: value });
    write(storage, VIEW_KEY, value);
  }
  const useView = () => useStore((state) => state.view);

  function toggleProjectCollapsed(projectId: string) {
    const next = toggled(getState().collapsedProjects, projectId);
    setState({ collapsedProjects: next });
    write(storage, COLLAPSED_KEY, JSON.stringify(next));
  }
  const useCollapsedProjects = () => useStore((state) => state.collapsedProjects);

  function toggleParentExpanded(sessionId: string) {
    setState({ expandedParents: toggled(getState().expandedParents, sessionId) });
  }
  const useExpandedParents = () => useStore((state) => state.expandedParents);

  function revealGroup(groupId: string) {
    const current = getState().revealedGroups;
    if (!current.includes(groupId)) setState({ revealedGroups: [...current, groupId] });
  }
  const useRevealedGroups = () => useStore((state) => state.revealedGroups);

  return {
    release: () => setState({ ...initial, columnOpen: null }),
    storedOpen,
    storeOpen,
    setSidebarOffset,
    useSidebarOffset,
    setColumnOpen,
    useColumnOpen,
    setOverlayOpen,
    useOverlayOpen,
    setOrganize,
    useOrganize,
    setView,
    useView,
    toggleProjectCollapsed,
    useCollapsedProjects,
    toggleParentExpanded,
    useExpandedParents,
    revealGroup,
    useRevealedGroups,
  };
}

export const {
  release,
  storedOpen,
  storeOpen,
  setSidebarOffset,
  useSidebarOffset,
  setColumnOpen,
  useColumnOpen,
  setOverlayOpen,
  useOverlayOpen,
  setOrganize,
  useOrganize,
  setView,
  useView,
  toggleProjectCollapsed,
  useCollapsedProjects,
  toggleParentExpanded,
  useExpandedParents,
  revealGroup,
  useRevealedGroups,
} = createSidebarLayoutStore(standalonePreferenceStorage);
