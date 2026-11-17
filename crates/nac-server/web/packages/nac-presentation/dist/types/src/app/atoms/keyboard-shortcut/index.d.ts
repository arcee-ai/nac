import type React from "react";
interface KeyboardShortcutProps {
    keys: string[];
    /** Styled for a dark surface, such as the inside of a tooltip. */
    inversed?: boolean;
    /**
     * Spell the key out — TAB rather than ⇥ — where the glyph is the whole hint
     * and has no combination around it to be read against.
     */
    spelled?: boolean;
    className?: string;
}
/** Renders a key combination as small caps, e.g. `["cmd", "k"]` → ⌘ K. */
declare const KeyboardShortcut: React.FC<KeyboardShortcutProps>;
export default KeyboardShortcut;
