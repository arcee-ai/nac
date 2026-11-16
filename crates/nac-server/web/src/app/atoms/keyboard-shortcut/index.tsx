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
    <div className={cn("flex gap-[3px]", className)}>
      {keys.map((key, index) => (
        <kbd
          key={index}
          className={cn(
            "type-tag inline-flex h-4 min-w-4 items-center justify-center rounded-xs border px-1 leading-none",
            inversed
              ? "text-secondary-inverse border-tertiary-inversed"
              : "border-tertiary bg-[var(--f-wash-1)] text-basic-tertiary",
          )}
        >
          {spelled ? key : keyGlyph(key)}
        </kbd>
      ))}
    </div>
  );
};

export default KeyboardShortcut;
