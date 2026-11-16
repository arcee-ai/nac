/** Distance from the bottom still counted as "at the bottom", in pixels. */
export declare const STICK_TOLERANCE_PX = 60;
export declare const distanceFromBottom: (element: HTMLElement) => number;
export declare function scrollToBottomInstantly(element: HTMLElement): void;
/**
 * Animated scroll that yields to the user: a wheel or touch during the
 * animation cancels it, so the view never fights someone reading back.
 * Returns whether the animation ran to completion.
 *
 * Pass a signal to drop an animation that has been overtaken — a caller that
 * re-aims at a moving target has to stop the previous run first, or the two
 * fight over `scrollTop` frame by frame.
 */
export declare function smoothScrollTo(element: HTMLElement, targetTop: number, durationMs?: number, signal?: AbortSignal): Promise<boolean>;
