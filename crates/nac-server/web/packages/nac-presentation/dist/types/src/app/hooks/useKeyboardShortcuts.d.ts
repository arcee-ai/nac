export interface KeyboardShortcutBinding {
    /** Modifiers plus the key, by name: `[MOD, "shift", "o"]`. */
    keys: string[];
    onTrigger: () => void;
    /** False while the shortcut has nothing to act on. */
    enabled?: boolean;
}
/**
 * App-wide shortcuts, matched on `window` for as long as the caller is mounted.
 *
 * A dialog outranks every binding here: while one is up it owns the keyboard,
 * and opening a second one behind it — or acting on the page the dialog covers —
 * is never what the keystroke meant. A binding without a modifier also steps
 * aside while the caret is in a field, where a bare letter is text.
 */
export declare function useKeyboardShortcuts(bindings: KeyboardShortcutBinding[]): void;
