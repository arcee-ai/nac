// URL scheme of the app. Routing is hash-based so that deep links work without
// a server-side catch-all: nac-web only serves the document at `/` and `/app`.

export const INSPECTOR_TABS = [
  "chat",
  "events",
  "threads",
  "worksets",
  "workspace",
] as const;

export type InspectorTab = (typeof INSPECTOR_TABS)[number];

export const DEFAULT_INSPECTOR_TAB: InspectorTab = "chat";

export function isInspectorTab(value: string | undefined): value is InspectorTab {
  return (INSPECTOR_TABS as readonly string[]).includes(value ?? "");
}

export const routes = {
  list: () => "/",
  session: (sessionId: string, tab: InspectorTab = DEFAULT_INSPECTOR_TAB) =>
    `/session/${encodeURIComponent(sessionId)}/${tab}`,
  designPreview: () => "/design",
};
