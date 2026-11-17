import { useEffect, useRef } from "react";

import {
  usePresentationKeyboardOwner,
  usePresentationLayers,
} from "@/app/providers/PresentationBoundary";

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
/** Elements whose own Enter or Space already means something. */
const ACTIVATABLE = 'button, a[href], summary, [role="button"], [role="option"], [role="radio"]';

/**
 * Whether a bare key is meant for the page: not for a field being written in,
 * and not for a focused control that Enter would itself activate.
 */
export function isAttentionKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (TYPING_TAGS.has(target.tagName) || target.isContentEditable) return false;
  return !target.closest(ACTIVATABLE);
}

/**
 * Bare-key shortcuts for the card that is asking for a decision: ⏎ and D for
 * a permission, 1–9 for an answer. They step aside while a dialog is open,
 * while the caret is in a field, and while a control has the focus, so a key
 * never answers something other than what the user is looking at.
 */
export function useAttentionKeys(
  enabled: boolean,
  onKey: (key: string, event: KeyboardEvent) => boolean,
): void {
  const layers = usePresentationLayers();
  const ownsKeyboard = usePresentationKeyboardOwner();
  const latest = useRef(onKey);
  useEffect(() => {
    latest.current = onKey;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!ownsKeyboard(event.target) || layers.openDepth() > 0) return;
      if (!isAttentionKeyTarget(event.target)) return;
      if (latest.current(event.key, event)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, layers, ownsKeyboard]);
}
