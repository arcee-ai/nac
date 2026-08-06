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
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

/** Narrow enough that overlays should take over the screen instead of floating. */
export const useIsMobile = () => useMediaQuery("(max-width: 768px)");
