import { useLayoutEffect, type RefObject } from "react";

/**
 * Pin an element's endless animations to the document timeline. Every copy is
 * then in step, and one that replaces another — a remounted badge, a status
 * swapped for the row it announced — carries on where the last one was instead
 * of starting over. Runs before paint, so the first frame is already in phase.
 */
export function pinToTimeline(element: Element | null): void {
  if (typeof element?.getAnimations !== "function") return;
  for (const animation of element.getAnimations({ subtree: true })) animation.startTime = 0;
}

/** `pinToTimeline` for an element whose animation comes and goes with `active`. */
export function useTimelinePhase(ref: RefObject<Element | null>, active: boolean): void {
  useLayoutEffect(() => {
    if (active) pinToTimeline(ref.current);
  }, [ref, active]);
}
