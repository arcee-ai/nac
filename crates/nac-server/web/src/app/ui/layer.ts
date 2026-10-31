import {
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  usePresentationInertTarget,
  usePresentationKeyboardOwner,
  usePresentationLayers,
} from "@/app/providers/PresentationBoundary";
import type { LayerHandlers, LayerKind } from "./layer-stack";

/** Cancels a Radix dismissal: the layer stack decides what Escape and outside presses close. */
export const keepOpen = (event: Event) => event.preventDefault();

export interface LayerOptions {
  open: boolean;
  kind: LayerKind;
  content: RefObject<HTMLElement | null>;
  anchor?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
  onOutsidePress?: () => void;
  inertBackground?: boolean;
}

export interface LayerHandle {
  /** A modal opened above this layer is still open. */
  covered: boolean;
  /** Whether this is the topmost layer, tooltips aside. For event handlers, not render. */
  isTop: () => boolean;
  /** The next close leaves focus where it is. */
  skipFocusRestore: () => void;
  markPressInside: () => void;
}

/** Registers an overlay with the layer stack of its presentation instance while `open`. */
export function useLayer({
  open,
  kind,
  content,
  anchor,
  onEscape,
  onOutsidePress,
  inertBackground = false,
}: LayerOptions): LayerHandle {
  const stack = usePresentationLayers();
  const ownsKeyboard = usePresentationKeyboardOwner();
  const inertTarget = usePresentationInertTarget();
  const [token] = useState(() => ({}));
  const handlers = useRef<LayerHandlers | null>(null);
  const opener = useRef<Element | null>(null);

  // Runs before any `autoFocus` field inside the layer takes the focus, which
  // would otherwise be all that is left to hand it back to.
  useInsertionEffect(() => {
    if (open) opener.current = document.activeElement;
  }, [open]);

  useLayoutEffect(() => {
    handlers.current = {
      kind,
      content,
      anchor,
      onEscape,
      onOutsidePress,
      inertBackground,
      ownsKeyboard,
      inertTarget,
    };
  });

  useLayoutEffect(() => {
    if (!open) return undefined;
    stack.open(token, handlers, opener.current);
    return () => stack.close(token);
  }, [open, stack, token]);

  useLayoutEffect(() => {
    stack.refresh();
  }, [stack, inertBackground, inertTarget]);

  const covered = useSyncExternalStore(
    stack.subscribe,
    () => stack.hasModalAbove(token),
    () => false,
  );

  return {
    covered,
    isTop: () => stack.isTop(token),
    skipFocusRestore: () => stack.skipFocusRestore(token),
    markPressInside: () => stack.markPressInside(token),
  };
}
