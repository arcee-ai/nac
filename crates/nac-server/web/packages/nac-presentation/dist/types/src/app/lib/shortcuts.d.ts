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
 * Starts a chat in the open project. Deliberately the same chord as
 * `NEW_PROJECT_KEYS`: the two never apply at once, so "make me a new one" stays
 * one gesture whose meaning follows whatever the page is showing.
 */
export declare const NEW_CHAT_KEYS: string[];
