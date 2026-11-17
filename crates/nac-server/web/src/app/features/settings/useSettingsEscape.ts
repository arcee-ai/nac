import { useEffect } from "react";

import {
  usePresentationKeyboardOwner,
  usePresentationLayers,
} from "@/app/providers/PresentationBoundary";

/** Fields, editable text and open lists keep Escape for themselves. */
function ownsEscape(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"))
    return true;
  return !!target.closest('[role="menu"], [role="listbox"], [role="combobox"]');
}

/**
 * Escape on the full-page Settings takeover leaves it, like the ← Back control
 * (and like the dialogs it replaced): back to where Settings was opened from,
 * or Home when the user arrived directly. A focused field, an open menu,
 * popover or dialog, or IME composition keeps the key.
 */
export function useSettingsEscape(leave: () => void): void {
  const layers = usePresentationLayers();
  const ownsKeyboard = usePresentationKeyboardOwner();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (!ownsKeyboard(event.target)) return;
      if (layers.openDepth() > 0 || ownsEscape(event.target)) return;
      event.preventDefault();
      leave();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [layers, leave, ownsKeyboard]);
}
