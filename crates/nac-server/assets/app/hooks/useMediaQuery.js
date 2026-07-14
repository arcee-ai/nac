import { React } from "../lib/html.js";

const { useSyncExternalStore } = React;

// Subscribe to a media query (SSR-safe-ish; buildless client only here).
export function useMediaQuery(query) {
  const mql = window.matchMedia(query);
  const subscribe = (cb) => {
    mql.addEventListener("change", cb);
    return () => mql.removeEventListener("change", cb);
  };
  return useSyncExternalStore(subscribe, () => mql.matches, () => mql.matches);
}

// Desktop = wide enough for the side-by-side board+inspector layout.
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
