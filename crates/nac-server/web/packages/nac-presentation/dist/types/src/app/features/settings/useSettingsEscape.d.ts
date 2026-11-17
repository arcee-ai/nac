/**
 * Escape on the full-page Settings takeover leaves it, like the ← Back control
 * (and like the dialogs it replaced): back to where Settings was opened from,
 * or Home when the user arrived directly. A focused field, an open menu,
 * popover or dialog, or IME composition keeps the key.
 */
export declare function useSettingsEscape(leave: () => void): void;
