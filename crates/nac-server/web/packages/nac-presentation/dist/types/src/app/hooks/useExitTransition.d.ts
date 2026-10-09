/**
 * Whether an `open`-gated dialog should still be rendered. A wrapper that drops
 * its `Modal` the moment `open` turns false takes the panel down with it, so on
 * a phone the slide-out never runs and the dialog just vanishes. Keeping the
 * wrapper mounted for the length of the transition lets `Modal` play its exit
 * and unmount itself.
 */
export declare function useExitTransition(open: boolean, exitMs?: number): boolean;
