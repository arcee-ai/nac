// URL scheme of the app. Routing is hash-based so that deep links work without
// a server-side catch-all: nac-web only serves the document at `/` and `/app`.

// The session screen always shows the chat; the URL only selects which panel
// the side box has open.
// Order is also the tab order in the side box.
export const SESSION_PANELS = [
  "threads",
  "files",
  "worksets",
  "history",
] as const;

export type SessionPanel = (typeof SESSION_PANELS)[number];

// The `files` panel is called Changes in the design; its route keeps the older
// name so links that are already out there still land on it.
export const SESSION_PANEL_LABEL: Record<SessionPanel, string> = {
  threads: "Threads",
  files: "Files",
  worksets: "Worksets",
  history: "History",
};

/**
 * Panels the wide side box tabs between. A wide box carries the revisions in
 * its footer chip, so History is a phone-only panel of the bottom bar.
 */
export const WIDE_SESSION_PANELS = SESSION_PANELS.filter(
  (panel) => panel !== "history",
);

export const DEFAULT_SESSION_PANEL: SessionPanel = "threads";

export function isSessionPanel(value: string | undefined): value is SessionPanel {
  return (SESSION_PANELS as readonly string[]).includes(value ?? "");
}

export const routes = {
  list: () => "/",
  session: (sessionId: string, panel: SessionPanel = DEFAULT_SESSION_PANEL) =>
    `/session/${encodeURIComponent(sessionId)}/${panel}`,
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
