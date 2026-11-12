import type React from "react";
import { cn } from "../../lib/cn";
import { keyGlyph } from "../../lib/shortcuts";

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
const KeyboardShortcut: React.FC<KeyboardShortcutProps> = ({
  keys,
  inversed = false,
  spelled = false,
  className = "",
}) => {
  if (keys.length === 0) return null;
  return (
    <div
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-full px-1.5 tag-label",
        inversed
          ? "border border-tertiary-inversed text-secondary-inverse"
          : "bg-elevation-level-2 text-basic-tertiary",
        className,
      )}
    >
      {keys.map((key, index) => (
        <kbd key={index}>{spelled ? key : keyGlyph(key)}</kbd>
      ))}
    </div>
  );
};

export default KeyboardShortcut;
