/** Distance from the bottom still counted as "at the bottom", in pixels. */
export const STICK_TOLERANCE_PX = 60;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export const distanceFromBottom = (element: HTMLElement) =>
  element.scrollHeight - (element.scrollTop + element.clientHeight);

export function scrollToBottomInstantly(element: HTMLElement): void {
  element.scrollTop = element.scrollHeight - element.clientHeight;
}

/**
 * Animated scroll that yields to the user: a wheel or touch during the
 * animation cancels it, so the view never fights someone reading back.
 * Returns whether the animation ran to completion.
 *
 * Pass a signal to drop an animation that has been overtaken — a caller that
 * re-aims at a moving target has to stop the previous run first, or the two
 * fight over `scrollTop` frame by frame.
 */
export function smoothScrollTo(
  element: HTMLElement,
  targetTop: number,
  durationMs = 300,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const from = element.scrollTop;
  const to = Math.min(Math.max(0, targetTop), maxTop);
  const distance = to - from;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!distance || durationMs <= 0 || reducedMotion) {
    element.scrollTop = to;
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let start: number | null = null;
    let frame = 0;
    let cancelled = false;

    const stop = (completed: boolean) => {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(frame);
      element.removeEventListener("wheel", interrupt);
      element.removeEventListener("touchstart", interrupt);
      signal?.removeEventListener("abort", interrupt);
      resolve(completed);
    };
    const interrupt = () => stop(false);

    element.addEventListener("wheel", interrupt, { passive: true, once: true });
    element.addEventListener("touchstart", interrupt, {
      passive: true,
      once: true,
    });
    signal?.addEventListener("abort", interrupt, { once: true });

    // Re-read the bottom each frame when we aimed at it: a send can grow the
    // transcript while the glide is still running, and a frozen `to` would
    // land short then snap.
    const aimingAtBottom = targetTop >= maxTop;
    const step = (timestamp: number) => {
      if (cancelled) return;
      start ??= timestamp;
      const progress = Math.min(1, (timestamp - start) / durationMs);
      const liveMax = Math.max(0, element.scrollHeight - element.clientHeight);
      const toNow = aimingAtBottom ? liveMax : Math.min(to, liveMax);
      const next = from + (toNow - from) * easeOutCubic(progress);
      // Content can shrink mid-glide (the last-turn min-height moving off a
      // bubble). Interpolating toward a smaller liveMax would scroll up; keep
      // the send motion one-way down.
      element.scrollTop = aimingAtBottom ? Math.max(element.scrollTop, next) : next;
      if (progress < 1) frame = requestAnimationFrame(step);
      else stop(true);
    };

    frame = requestAnimationFrame(step);
  });
}
