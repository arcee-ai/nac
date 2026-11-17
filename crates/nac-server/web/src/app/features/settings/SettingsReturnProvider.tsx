import { useLayoutEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { SettingsReturnContext, createSettingsReturnOwner } from "./settingsReturn";
import { isSettingsPath } from "./settingsRoute";

/** Remembers the last non-Settings location of this presentation's router. */
export function SettingsReturnProvider({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const [owner] = useState(createSettingsReturnOwner);
  useLayoutEffect(() => {
    owner.activate();
    return owner.deactivate;
  }, [owner]);
  useLayoutEffect(() => {
    owner.location(`${pathname}${search}`, isSettingsPath(pathname));
  }, [owner, pathname, search]);
  return <SettingsReturnContext.Provider value={owner}>{children}</SettingsReturnContext.Provider>;
}
