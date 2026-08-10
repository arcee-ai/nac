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
/** How long the view takes to glide onto content that has just arrived. */
const FOLLOW_DURATION_MS = 200;
/**
 * Past a viewport of catching up the glide gives way to a snap. Following a
 * stream never asks for more than a few lines at a time, so anything this far
 * is a bulk arrival — a transcript opening, a snapshot landing — and animating
 * through it would read as the page running away on its own.
 */
const FOLLOW_MAX_VIEWPORTS = 1;
/**
 * How long a programmatic scroll keeps being recognised as ours after it has
 * finished. Scroll events are delivered a frame or two late, so one that lands
 * after the flag cleared would read as the user pulling away and would unstick
 * follow-mode just as the stream was catching up.
 */
const PROGRAMMATIC_SETTLE_MS = 50;
/** How long an input event vouches for the scrolling that follows it. */
const USER_INTENT_WINDOW_MS = 150;
/** Keys that scroll a container rather than acting on what is focused. */
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

export interface StickToBottomOptions {
  /**
   * Identity of what is being scrolled. Changing it starts the view over, which
   * matters because the component is reused across sessions: React routes both
   * session URLs to the same element, so nothing here would otherwise unmount.
   */
  resetKey?: string | null;
}

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
 * after its code blocks have laid out. New content is glided onto rather than
 * snapped to, which is what makes a stream read as text arriving instead of as
 * the view ticking down a line at a time. Wheel handling mirrors ArceeFM's
 * `useChatScroll`: upward wheel unsticks immediately so follow-mode yields
 * before the next layout pin.
 *
 * Letting go is deliberately driven by input events rather than by position.
 * Content that shrinks — a finished message re-rendering as one document rather
 * than as the blocks it streamed in — clamps `scrollTop` and is indistinguishable
 * from a scrollbar drag if only the numbers are consulted, which used to abandon
 * follow-mode a hundred pixels short of the end of a stream.
 */
export function useStickToBottom({
  resetKey = null,
}: StickToBottomOptions = {}): StickToBottom {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  // Whether the view is following new content. A ref rather than state: the
  // observers below run outside React, and nothing renders differently for it.
  const stuck = useRef(true);
  // Our own scrolling passes through the same listener as the user's own, and
  // its intermediate positions would otherwise read as scrolling away.
  const animating = useRef(false);
  const prevScrollHeight = useRef(0);
  const isUserScrolling = useRef(false);
  const userScrollTimeout = useRef<number | null>(null);
  // The glide currently following new content, so it can be called off when it
  // is overtaken by more growth, by a reflow, or by the user taking the wheel.
  const followAbort = useRef<AbortController | null>(null);
  const followFrame = useRef<number | null>(null);
  /** Growth arrived mid-glide; re-aim once the current one lands. */
  const followPending = useRef(false);
  const hasPinned = useRef(false);

  const settleTimeout = useRef<number | null>(null);

  /** Take ownership of the view: what moves it from here is us, not the user. */
  const beginProgrammaticScroll = useCallback(() => {
    if (settleTimeout.current !== null) {
      clearTimeout(settleTimeout.current);
      settleTimeout.current = null;
    }
    isUserScrolling.current = false;
    animating.current = true;
  }, []);

  /** Hand the view back, once the events we caused have drained. */
  const endProgrammaticScroll = useCallback(() => {
    if (settleTimeout.current !== null) clearTimeout(settleTimeout.current);
    settleTimeout.current = window.setTimeout(() => {
      settleTimeout.current = null;
      animating.current = false;
    }, PROGRAMMATIC_SETTLE_MS);
  }, []);

  /**
   * Bring the jump affordance in line with where the view actually is. Called
   * from everything that moves it, because offering a way back to content that
   * is already on screen — or hiding it while the reader is far above — is worse
   * than the affordance not existing.
   */
  const syncJumpButton = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setShowJumpButton(distanceFromBottom(element) > JUMP_BUTTON_TOLERANCE_PX);
  }, []);

  const cancelFollow = useCallback(() => {
    followAbort.current?.abort();
    followAbort.current = null;
    followPending.current = false;
    if (followFrame.current !== null) {
      cancelAnimationFrame(followFrame.current);
      followFrame.current = null;
    }
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;

    // A scroll event says the view moved but not who moved it, and the two are
    // not tellable apart from the position alone: shrinking content clamps
    // `scrollTop` and looks exactly like someone dragging the scrollbar up.
    // Follow-mode is therefore only ever given up on the back of an actual
    // input event, which is what these mark. The window is generous because a
    // gesture and the scrolling it causes are not delivered together.
    const markUserIntent = () => {
      isUserScrolling.current = true;
      if (userScrollTimeout.current !== null) {
        clearTimeout(userScrollTimeout.current);
      }
      userScrollTimeout.current = window.setTimeout(() => {
        isUserScrolling.current = false;
        userScrollTimeout.current = null;
      }, USER_INTENT_WINDOW_MS);
    };

    const onScroll = () => {
      const distance = distanceFromBottom(element);
      const reflowed = element.scrollHeight !== prevScrollHeight.current;
      prevScrollHeight.current = element.scrollHeight;

      // Nobody scrolls and resizes the document in the same event, so a changed
      // height means the content moved under the view rather than the other way
      // round. The growth observer puts the bottom back.
      if (reflowed) {
        // Sitting at the bottom is unambiguous whoever put us there, and it is
        // the one reading worth taking from such an event: dropping it would
        // leave follow-mode off when the reader scrolled back down and their
        // last scroll event happened to coincide with new content landing.
        if (distance <= STICK_TOLERANCE_PX) stuck.current = true;
        return;
      }
      // Anything else while we are driving is our own animation echoing back.
      if (animating.current && !isUserScrolling.current) return;

      if (distance > UNSTICK_TOLERANCE_PX) {
        if (stuck.current) cancelFollow();
        stuck.current = false;
      } else {
        stuck.current = true;
      }

      syncJumpButton();
    };

    const onWheel = (event: WheelEvent) => {
      markUserIntent();

      const distance = distanceFromBottom(element);
      if (event.deltaY < 0 && distance > UNSTICK_TOLERANCE_PX) {
        cancelFollow();
        stuck.current = false;
        syncJumpButton();
      } else if (event.deltaY > 0 && distance <= STICK_TOLERANCE_PX) {
        stuck.current = true;
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      // Only a press on the scrollbar gutter is a scroll gesture. Pressing the
      // text is not one, and counting it as such let a single click on a thread
      // box hand follow-mode away for the rest of the run.
      const rect = element.getBoundingClientRect();
      if (event.clientX >= rect.left + element.clientWidth) markUserIntent();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) markUserIntent();
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", onWheel, { passive: true });
    // Dragging the scrollbar, swiping, and paging with the keyboard produce no
    // wheel event, so without these the only trace they leave is the scrolling
    // itself — which on its own says nothing about who caused it. Each is
    // narrowed to the gesture that actually scrolls: a tap is not a swipe, and
    // Enter on a focused button is not a page down.
    element.addEventListener("pointerdown", onPointerDown, { passive: true });
    element.addEventListener("touchmove", markUserIntent, { passive: true });
    element.addEventListener("keydown", onKeyDown);
    onScroll();
    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("touchmove", markUserIntent);
      element.removeEventListener("keydown", onKeyDown);
      if (userScrollTimeout.current !== null) {
        clearTimeout(userScrollTimeout.current);
      }
    };
  }, [cancelFollow, syncJumpButton]);

  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element || !content) return undefined;

    /** Land on the bottom edge now, giving up on any glide under way. */
    const snap = () => {
      cancelFollow();
      beginProgrammaticScroll();
      scrollToBottomInstantly(element);
      syncJumpButton();
      endProgrammaticScroll();
    };

    // Observer callbacks run after layout, so the height a markdown block just
    // settled on is already measurable and the glide aims at the real bottom.
    const follow = (): void => {
      if (!stuck.current) return;
      // One glide at a time. Growth that lands mid-flight is picked up when the
      // current one finishes, so the target is never left behind.
      if (followAbort.current) {
        followPending.current = true;
        return;
      }

      const distance = distanceFromBottom(element);
      syncJumpButton();
      if (distance <= 0) return;
      // Only content that turned up while the view was already settled at the
      // bottom is worth gliding onto. The first pin puts us there in the first
      // place, so it never animates however short the transcript is.
      const firstPin = !hasPinned.current;
      hasPinned.current = true;
      if (firstPin || distance > element.clientHeight * FOLLOW_MAX_VIEWPORTS) {
        snap();
        return;
      }

      const controller = new AbortController();
      followAbort.current = controller;
      beginProgrammaticScroll();
      void smoothScrollTo(
        element,
        element.scrollHeight,
        FOLLOW_DURATION_MS,
        controller.signal,
      ).then((completed) => {
        // Overtaken by a snap or by another glide, which owns the state now.
        if (followAbort.current !== controller) return;
        followAbort.current = null;
        endProgrammaticScroll();
        syncJumpButton();
        if (!completed) {
          // A wheel or touch cut the glide short; the input handlers have
          // already decided what that meant for follow-mode.
          followPending.current = false;
          return;
        }
        if (followPending.current) {
          followPending.current = false;
          follow();
        }
      });
    };

    // A burst of callbacks — a markdown block, then the code blocks inside it
    // settling — should produce one glide, not one per measurement.
    const scheduleFollow = () => {
      if (followFrame.current !== null) return;
      followFrame.current = requestAnimationFrame(() => {
        followFrame.current = null;
        follow();
      });
    };

    const growth = new ResizeObserver(() => {
      // Observer callbacks still run inside the frame that laid the content out,
      // so pinning here beats the paint. Deferring the first one would show the
      // reader a frame at the top of a transcript they never scrolled to.
      if (!hasPinned.current) follow();
      else scheduleFollow();
    });
    growth.observe(content);
    // The container itself changes when a side panel opens or the window is
    // resized, which reflows the text and silently drifts the bottom. That is a
    // correction rather than new content, so it lands instantly — gliding
    // through it would read as the page moving on its own.
    const reflow = new ResizeObserver(() => {
      if (stuck.current) snap();
    });
    reflow.observe(element);

    return () => {
      growth.disconnect();
      reflow.disconnect();
      cancelFollow();
      if (settleTimeout.current !== null) {
        clearTimeout(settleTimeout.current);
        settleTimeout.current = null;
      }
    };
  }, [
    beginProgrammaticScroll,
    cancelFollow,
    endProgrammaticScroll,
    syncJumpButton,
  ]);

  // Opening a transcript is a fresh start however the last one was left: an
  // abandoned follow-mode must not carry over, and the arriving content has to
  // be pinned to rather than glided onto, since none of it has been read yet.
  useEffect(() => {
    cancelFollow();
    stuck.current = true;
    hasPinned.current = false;
    prevScrollHeight.current = 0;
  }, [resetKey, cancelFollow]);

  const jumpToLatest = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    cancelFollow();
    stuck.current = true;
    setShowJumpButton(false);
    beginProgrammaticScroll();
    void smoothScrollTo(element, element.scrollHeight, JUMP_DURATION_MS).then(
      (completed) => {
        endProgrammaticScroll();
        // An interrupted animation means the user took over on the way down.
        if (!completed) {
          stuck.current = distanceFromBottom(element) <= STICK_TOLERANCE_PX;
          syncJumpButton();
        }
      },
    );
  }, [
    beginProgrammaticScroll,
    cancelFollow,
    endProgrammaticScroll,
    syncJumpButton,
  ]);

  return { scrollRef, contentRef, showJumpButton, jumpToLatest };
}
