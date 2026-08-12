import { useEffect, useRef } from "react";

import { modalStackDepth } from "@/app/hooks/useModalStack";
import { hasModifier, matchesShortcut } from "@/app/lib/shortcuts";

export interface KeyboardShortcutBinding {
  /** Modifiers plus the key, by name: `[MOD, "shift", "o"]`. */
  keys: string[];
  onTrigger: () => void;
  /** False while the shortcut has nothing to act on. */
  enabled?: boolean;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Whether the keystroke was meant for a field rather than for the app. */
function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return TYPING_TAGS.has(element.tagName) || element.isContentEditable;
}

/**
 * App-wide shortcuts, matched on `window` for as long as the caller is mounted.
 *
 * A dialog outranks every binding here: while one is up it owns the keyboard,
 * and opening a second one behind it — or acting on the page the dialog covers —
 * is never what the keystroke meant. A binding without a modifier also steps
 * aside while the caret is in a field, where a bare letter is text.
 */
export function useKeyboardShortcuts(
  bindings: KeyboardShortcutBinding[],
): void {
  // Read through a ref, so a caller may pass a fresh array each render without
  // the listener being torn down and rebuilt along with it.
  const latest = useRef(bindings);
  useEffect(() => {
    latest.current = bindings;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A held key repeats; opening one modal per repeat is not the intent.
      if (event.repeat) return;
      for (const binding of latest.current) {
        if (binding.enabled === false) continue;
        if (!matchesShortcut(event, binding.keys)) continue;
        if (modalStackDepth() > 0) return;
        if (!hasModifier(binding.keys) && isTyping(event.target)) return;
        event.preventDefault();
        binding.onTrigger();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
