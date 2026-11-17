/**
 * The platform's command modifier, named as a key so a shortcut can be declared
 * once and both matched and drawn from the same list.
 */
export declare const MOD: string;
export declare const keyGlyph: (key: string) => string;
/** Whether a shortcut is one the browser would not have delivered on its own. */
export declare const hasModifier: (keys: string[]) => boolean;
/**
 * Whether `event` is exactly `keys` — no more modifiers than were asked for, so
 * ⌘⇧O does not also fire what ⌘O is bound to.
 */
export declare function matchesShortcut(event: KeyboardEvent, keys: string[]): boolean;
/**
 * Opens the new-project dialog. ⌘⇧O rather than ⌘N, which a browser keeps for
 * its own window and never hands to the page.
 */
export declare const NEW_PROJECT_KEYS: string[];
/**
 * Starts a session in the open project. Deliberately the same chord as
 * `NEW_PROJECT_KEYS`: the two never apply at once, so "make me a new one" stays
 * one gesture whose meaning follows whatever the page is showing.
 */
export declare const NEW_CHAT_KEYS: string[];
/** Focus vocabulary for the same chord. */
export declare const NEW_SESSION_IN_PROJECT_KEYS: string[];
/** The ⌘K command palette: sessions, projects, actions and settings. */
export declare const COMMAND_PALETTE_KEYS: string[];
/** The ⌘/ sheet that lists this catalog. */
export declare const SHORTCUT_SHEET_KEYS: string[];
/**
 * A new session. Browsers keep ⌘N for a window, so on the web this chord is
 * delivered only by the native shell's menu; the palette offers the same act.
 */
export declare const NEW_SESSION_KEYS: string[];
/** Show or hide the session sidebar. */
export declare const TOGGLE_SIDEBAR_KEYS: string[];
/** Pin the open drawer as a side column, or float it again. */
export declare const DOCK_DRAWER_KEYS: string[];
/** Opens the session that has waited longest for you (Inbox › Needs you). */
export declare const NEXT_NEEDS_YOU_KEYS: string[];
export type ShortcutGroup = "General" | "Navigation" | "Session" | "Attention card";
export interface ShortcutEntry {
    id: string;
    /** Keys by name, drawn with `keyGlyph`; a bare key such as "1–9" is spelled. */
    keys: string[];
    label: string;
    group: ShortcutGroup;
    /** Shown as written rather than as glyphs (ranges such as 1–9). */
    spelled?: boolean;
}
/**
 * The one catalog of the app's shortcuts. The ⌘/ sheet and Settings ›
 * Shortcuts draw from it, and bindings import their chords from the constants
 * above so what is drawn and what is matched cannot drift apart.
 */
export declare const SHORTCUTS: readonly ShortcutEntry[];
export declare const SHORTCUT_GROUPS: readonly ShortcutGroup[];
