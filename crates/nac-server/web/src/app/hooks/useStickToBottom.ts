import { useCallback, useEffect, useRef, useState } from "react";

import {
  STICK_TOLERANCE_PX,
  distanceFromBottom,
  scrollToBottomInstantly,
  smoothScrollTo,
} from "@/app/lib/scroll";

/** How far up the user has to be before the jump-to-latest affordance appears. */
const JUMP_BUTTON_TOLERANCE_PX = 400;

export interface StickToBottom {
  /** The scrolling element. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Its single child, whose growth is what pins the view. */
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** True when the user is far enough up to warrant offering a way back. */
  showJumpButton: boolean;
  jumpToLatest: () => void;
}

/**
 * Keeps a scroll container pinned to its bottom edge as content grows, and
 * lets go the moment the user scrolls up.
 *
 * Growth is detected by observing the content element rather than by watching
 * a dependency, so it also covers the height a markdown block only settles on
 * after its code blocks have laid out. Nothing here needs to know what is
 * being rendered.
 */
export function useStickToBottom(): StickToBottom {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  // Whether the view is following new content. A ref rather than state: the
  // observers below run outside React, and nothing renders differently for it.
  const stuck = useRef(true);
  // The jump animation passes through the same listener as the user's own
  // scrolling, and its intermediate positions would read as scrolling away.
  const animating = useRef(false);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;

    const onScroll = () => {
      if (animating.current) return;
      const distance = distanceFromBottom(element);
      stuck.current = distance <= STICK_TOLERANCE_PX;
      setShowJumpButton(distance > JUMP_BUTTON_TOLERANCE_PX);
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element || !content) return undefined;

    // Observer callbacks run after layout, so the height a markdown block just
    // settled on is already measurable and the jump lands on the real bottom.
    // The scroll event this queues reports zero distance, which leaves the
    // sticky state exactly where it was.
    const pin = () => {
      if (stuck.current) scrollToBottomInstantly(element);
    };

    // The content grows with new messages; the container itself changes when a
    // side panel opens, which reflows the text and silently drifts the bottom.
    const observer = new ResizeObserver(pin);
    observer.observe(content);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const jumpToLatest = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    stuck.current = true;
    setShowJumpButton(false);
    animating.current = true;
    void smoothScrollTo(element, element.scrollHeight).then((completed) => {
      animating.current = false;
      // An interrupted animation means the user took over on the way down.
      if (!completed) {
        const distance = distanceFromBottom(element);
        stuck.current = distance <= STICK_TOLERANCE_PX;
        setShowJumpButton(distance > JUMP_BUTTON_TOLERANCE_PX);
      }
    });
  }, []);

  return { scrollRef, contentRef, showJumpButton, jumpToLatest };
}
