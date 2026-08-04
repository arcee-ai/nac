import { useCallback, useEffect, useRef, useState } from "react";

import {
  STICK_TOLERANCE_PX,
  distanceFromBottom,
  scrollToBottomInstantly,
  smoothScrollTo,
} from "@/app/lib/scroll";

/** How far up the user has to be before the jump-to-latest affordance appears. */
const JUMP_BUTTON_TOLERANCE_PX = 400;
/** Distance from bottom that unsticks follow-mode (matches ArceeFM). */
const UNSTICK_TOLERANCE_PX = 60;
/** Duration of the jump-to-latest animation. */
const JUMP_DURATION_MS = 400;

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
 * after its code blocks have laid out. Wheel handling mirrors ArceeFM's
 * `useChatScroll`: upward wheel unsticks immediately so follow-mode yields
 * before the next layout pin.
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
  const prevScrollTop = useRef(0);
  const isUserScrolling = useRef(false);
  const userScrollTimeout = useRef<number | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;

    const onScroll = () => {
      if (animating.current && !isUserScrolling.current) {
        prevScrollTop.current = element.scrollTop;
        return;
      }

      const distance = distanceFromBottom(element);
      const scrollingUp = element.scrollTop < prevScrollTop.current;
      prevScrollTop.current = element.scrollTop;

      if (distance > UNSTICK_TOLERANCE_PX) {
        stuck.current = false;
      } else if (distance <= STICK_TOLERANCE_PX) {
        stuck.current = true;
      } else if (scrollingUp) {
        stuck.current = false;
      }

      setShowJumpButton(distance > JUMP_BUTTON_TOLERANCE_PX);
    };

    const onWheel = (event: WheelEvent) => {
      isUserScrolling.current = true;
      if (userScrollTimeout.current !== null) {
        clearTimeout(userScrollTimeout.current);
      }
      userScrollTimeout.current = window.setTimeout(() => {
        isUserScrolling.current = false;
        userScrollTimeout.current = null;
      }, 150);

      const distance = distanceFromBottom(element);
      if (event.deltaY < 0 && distance > UNSTICK_TOLERANCE_PX) {
        stuck.current = false;
        setShowJumpButton(distance > JUMP_BUTTON_TOLERANCE_PX);
      } else if (event.deltaY > 0 && distance <= STICK_TOLERANCE_PX) {
        stuck.current = true;
      }
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", onWheel, { passive: true });
    onScroll();
    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", onWheel);
      if (userScrollTimeout.current !== null) {
        clearTimeout(userScrollTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element || !content) return undefined;

    // Observer callbacks run after layout, so the height a markdown block just
    // settled on is already measurable and the jump lands on the real bottom.
    const pin = () => {
      if (!stuck.current) return;
      // Mark as programmatic so a reflow-triggered scroll event does not
      // unstick follow-mode the way a real user scroll would.
      isUserScrolling.current = false;
      animating.current = true;
      scrollToBottomInstantly(element);
      prevScrollTop.current = element.scrollTop;
      window.setTimeout(() => {
        animating.current = false;
      }, 50);
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
    isUserScrolling.current = false;
    void smoothScrollTo(
      element,
      element.scrollHeight,
      JUMP_DURATION_MS,
    ).then((completed) => {
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
