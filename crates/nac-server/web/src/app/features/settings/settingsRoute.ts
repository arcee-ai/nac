import { routes } from "@/app/lib/routes";

/** Whether a path is the Settings page (any section, or the phone's section list). */
export function isSettingsPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

/** Section a Settings path names, or null for the bare list. */
export function settingsSectionFromPath(pathname: string): string | null {
  const [, root, section] = pathname.split("/");
  if (root !== "settings") return null;
  return section ? decodeURIComponent(section) : null;
}

/**
 * Settings › Capabilities can describe the session the user came from. The
 * session rides along as `?session=`, and product navigation treats it as the
 * current session while that page is open.
 */
export function capabilitiesHref(sessionId: string | null): string {
  const base = routes.settings("capabilities");
  return sessionId ? `${base}?session=${encodeURIComponent(sessionId)}` : base;
}

/** The session the product-navigation bridge treats as current on this path. */
export function productSessionFromLocation(
  pathname: string,
  search: string,
  sessionFromPath: string | null,
): string | null {
  if (sessionFromPath) return sessionFromPath;
  if (settingsSectionFromPath(pathname) !== "capabilities") return null;
  return new URLSearchParams(search).get("session") || null;
}
