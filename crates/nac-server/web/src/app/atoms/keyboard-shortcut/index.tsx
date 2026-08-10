import type React from "react";
import { cn } from "../../lib/cn";

const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/** Names accepted in `keys`, rendered as the glyph the platform uses. */
const SYMBOLS: Record<string, string> = {
  ctrl: isMac ? "⌘" : "⌃",
  control: isMac ? "⌘" : "⌃",
  cmd: "⌘",
  command: "⌘",
  meta: isMac ? "⌘" : "⊞",
  shift: "⇧",
  alt: isMac ? "⌥" : "Alt",
  option: isMac ? "⌥" : "Alt",
  enter: "⏎",
  return: "⏎",
  esc: "⎋",
  escape: "⎋",
  tab: "⇥",
  delete: "⌫",
  backspace: "⌫",
  space: "␣",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

const glyph = (key: string) => SYMBOLS[key.toLowerCase()] ?? key.toUpperCase();

interface KeyboardShortcutProps {
  keys: string[];
  /** Styled for a dark surface, such as the inside of a tooltip. */
  inversed?: boolean;
  className?: string;
}

/** Renders a key combination as small caps, e.g. `["cmd", "k"]` → ⌘ K. */
const KeyboardShortcut: React.FC<KeyboardShortcutProps> = ({
  keys,
  inversed = false,
  className = "",
}) => {
  if (keys.length === 0) return null;
  return (
    <div className={cn("flex gap-[3px]", className)}>
      {keys.map((key, index) => (
        <kbd
          key={index}
          className={cn(
            "inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-[3px] border tag-label",
            inversed
              ? "text-basic-secondary-inverse border-tertiary-inversed"
              : "text-basic-secondary border-secondary bg-input",
          )}
        >
          {glyph(key)}
        </kbd>
      ))}
    </div>
  );
};

export default KeyboardShortcut;
