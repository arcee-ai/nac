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
 * New session, everywhere: Home's composer for the current project. Never a
 * project-creation shortcut. ⌘⇧O rather than ⌘N, which browsers reserve for a
 * window and never hand to the page. Chrome, Edge and Firefox bind this chord to
 * their bookmark manager but let the page claim it first.
 */
export declare const NEW_SESSION_KEYS: string[];
/**
 * The native app's File › New Session. Delivered by the native menu only, so
 * it is advertised only when that menu exists.
 */
export declare const NATIVE_NEW_SESSION_KEYS: string[];
/** The ⌘K command palette: sessions, projects, actions and settings. */
export declare const COMMAND_PALETTE_KEYS: string[];
/** The ⌘/ sheet that lists this catalog. */
export declare const SHORTCUT_SHEET_KEYS: string[];
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
/** The catalog for this presentation: the native menu's chords only where it exists. */
export declare function shortcutsFor(nativeMenu: boolean): readonly ShortcutEntry[];
export declare const SHORTCUT_GROUPS: readonly ShortcutGroup[];
