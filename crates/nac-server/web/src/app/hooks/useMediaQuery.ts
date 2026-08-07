import { useCallback, useMemo, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  const mql = useMemo(() => window.matchMedia(query), [query]);
  const subscribe = useCallback(
    (listener: () => void) => {
      mql.addEventListener("change", listener);
      return () => mql.removeEventListener("change", listener);
    },
    [mql],
  );
  const snapshot = useCallback(() => mql.matches, [mql]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Wide enough for the side-by-side board and inspector layout. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1280px)");

/**
 * Narrow enough that overlays should take over the screen instead of floating.
 * The bound is exclusive: at exactly 768px the design still shows the tablet
 * layout, with the filters rail and the side box beside the chat.
 */
export const useIsMobile = () => useMediaQuery("(max-width: 767.98px)");

/**
 * The design's middle tier, between the phone and the full desktop bar. The
 * header drops the wordmark for the signet and tightens its padding here.
 */
export const useIsTablet = () =>
  useMediaQuery("(min-width: 768px) and (max-width: 1279.98px)");
