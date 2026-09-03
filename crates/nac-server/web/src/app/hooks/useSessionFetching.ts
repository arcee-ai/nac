import { useEffect, useRef, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";

import { queryKeys } from "@/app/services/queries";

/**
 * Below this a fetch is over before the eye could follow it, and a bar that
 * appears for one frame is worse than no bar at all. Most reads are served from
 * cache and never get this far.
 */
const APPEAR_AFTER_MS = 150;

/** Once shown, the bar stays long enough to be read as one refresh. */
const MIN_VISIBLE_MS = 500;

/**
 * Whether anything belonging to this session is being fetched right now — the
 * snapshot, the file listing, a diff, the revisions — reported as something
 * worth showing rather than as raw query state.
 *
 * Every session-scoped key starts `["session", id]`, so one filter covers the
 * whole panel however its parts are split up. The event stream can invalidate
 * several of those at once, hence the smoothing: the point is to say "this is
 * refreshing", not to strobe once per request.
 */
export function useSessionFetching(sessionId: string): boolean {
  const fetching =
    useIsFetching({
      queryKey: queryKeys.sessionRoot(sessionId),
      predicate: (query) => {
        // Inbox and spawn lists poll on a timer. Their first load still
        // counts; a heartbeat against a warm cache does not, or the
        // delegated panel would keep the hairline lit during a run.
        if (query.state.data === undefined) return true;
        const interval = (query.options as { refetchInterval?: unknown }).refetchInterval;
        return !(typeof interval === "number" && interval > 0);
      },
    }) > 0;
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (fetching) {
      if (visible) return undefined;
      const timer = window.setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, APPEAR_AFTER_MS);
      return () => clearTimeout(timer);
    }

    if (!visible) return undefined;
    const remaining = MIN_VISIBLE_MS - (Date.now() - shownAt.current);
    const timer = window.setTimeout(() => setVisible(false), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [fetching, visible]);

  return visible;
}
