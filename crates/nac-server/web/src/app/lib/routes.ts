// URL scheme of the app. Routing is hash-based so that deep links work without
// a server-side catch-all: nac-web only serves the document at `/` and `/app`.

// The session screen always shows the chat; the URL only selects which panel
// the side box has open.
// Order is also the tab order in the side box.
export const SESSION_PANELS = ["threads", "files", "worksets"] as const;

export type SessionPanel = (typeof SESSION_PANELS)[number];

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
