import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { SettingsReturnContext } from "./settingsReturn";
import { isSettingsPath } from "./settingsRoute";

/** Remembers the last non-Settings location of this presentation's router. */
export function SettingsReturnProvider({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const origin = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!isSettingsPath(pathname)) origin.current = `${pathname}${search}`;
  }, [pathname, search]);
  return <SettingsReturnContext.Provider value={origin}>{children}</SettingsReturnContext.Provider>;
}
