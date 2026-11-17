/** Whether a path is the Settings page (any section, or the phone's section list). */
export declare function isSettingsPath(pathname: string): boolean;
/** Section a Settings path names, or null for the bare list. */
export declare function settingsSectionFromPath(pathname: string): string | null;
/**
 * Settings › Capabilities can describe the session the user came from. The
 * session rides along as `?session=`, and product navigation treats it as the
 * current session while that page is open.
 */
export declare function capabilitiesHref(sessionId: string | null): string;
/** The session the product-navigation bridge treats as current on this path. */
export declare function productSessionFromLocation(pathname: string, search: string, sessionFromPath: string | null): string | null;
