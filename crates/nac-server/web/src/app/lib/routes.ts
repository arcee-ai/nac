// URL scheme of the app. Routing is hash-based so that deep links work without
// a server-side catch-all: nac-web only serves the document at `/` and `/app`.

// The session screen always shows the chat; the URL only selects which panel
// the side box has open.
// Order is also the tab order in the side box.
export const SESSION_PANELS = [
  "threads",
  "actions",
  "files",
  "delegated",
  "worksets",
  "history",
] as const;

export type SessionPanel = (typeof SESSION_PANELS)[number];

// The `files` panel is called Changes in the design; its route keeps the older
// name so links that are already out there still land on it.
export const SESSION_PANEL_LABEL = {
  threads: "Threads",
  actions: "Actions",
  delegated: "Related Sessions",
  files: "Files",
  worksets: "Worksets",
  history: "History",
} satisfies Record<SessionPanel, string>;

/** Bookmarks that still use the Agent Actions path from before `/actions`. */
const SESSION_PANEL_ALIASES: Record<string, SessionPanel> = {
  thoughts: "actions",
};

/**
 * Panels the wide side box tabs between. A wide box carries the revisions in
 * its footer chip, so History is a phone-only panel of the bottom bar.
 */
export const WIDE_SESSION_PANELS = SESSION_PANELS.filter(
  (panel) => panel !== "history",
);

export const DEFAULT_SESSION_PANEL: SessionPanel = "actions";

export function isSessionPanel(
  value: string | undefined,
): value is SessionPanel {
  // SAFETY: the cast only widens the readonly tuple to a mutable array for
  // `includes`; no element is ever written through it.
  return (SESSION_PANELS as readonly string[]).includes(value ?? "");
}

export function sessionPanelFromPath(value: string | undefined): SessionPanel {
  if (value && value in SESSION_PANEL_ALIASES)
    return SESSION_PANEL_ALIASES[value];
  return isSessionPanel(value) ? value : DEFAULT_SESSION_PANEL;
}

export const routes = {
  list: () => "/",
  session: (sessionId: string, panel: SessionPanel = DEFAULT_SESSION_PANEL) =>
    `/session/${encodeURIComponent(sessionId)}/${panel}`,
  /** Redirects to the project's newest session, or offers to start one. */
  project: (projectId: string) => `/project/${encodeURIComponent(projectId)}`,
  designPreview: () => "/design",
};

/**
 * Session the path points at, or null on any other screen. The top bar sits in
 * the layout route, above the match that carries `:sessionId`, so it cannot
 * read the parameter from the router.
 */
export function sessionIdFromPath(pathname: string): string | null {
  const [, section, id] = pathname.split("/");
  if (section !== "session" || !id) return null;
  return decodeURIComponent(id);
}

/** Project the path points at, for the same reason as `sessionIdFromPath`. */
export function projectIdFromPath(pathname: string): string | null {
  const [, section, id] = pathname.split("/");
  if (section !== "project" || !id) return null;
  return decodeURIComponent(id);
}
