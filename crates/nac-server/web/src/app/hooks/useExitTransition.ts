import { useEffect, useState } from "react";

/** Kept in step with the mobile slide transition in `atoms/modal`. */
const EXIT_MS = 300;

/**
 * Whether an `open`-gated dialog should still be rendered. A wrapper that drops
 * its `Modal` the moment `open` turns false takes the panel down with it, so on
 * a phone the slide-out never runs and the dialog just vanishes. Keeping the
 * wrapper mounted for the length of the transition lets `Modal` play its exit
 * and unmount itself.
 */
export function useExitTransition(open: boolean, exitMs = EXIT_MS): boolean {
  const [mounted, setMounted] = useState(open);

  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) return undefined;
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);

  return mounted;
}
