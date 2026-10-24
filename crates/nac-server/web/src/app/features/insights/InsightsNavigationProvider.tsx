import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import {
  InsightsNavigationContext,
  type InsightsNavigationTarget,
} from "@/app/features/insights/useInsightsNavigation";
import type { SessionPanel } from "@/app/lib/routes";

/**
 * Lends the session page's id, panels and `focusPanel` to
 * `useInsightsNavigation`. The value changes only with the session and its
 * panels: the page hands over a new `focusPanel` on every render, and the
 * transcript rows that read this context must not re-render with it.
 */
export function InsightsNavigationProvider({
  sessionId,
  panels,
  focusPanel,
  children,
}: InsightsNavigationTarget & { children: ReactNode }) {
  const latestFocusPanel = useRef(focusPanel);
  useLayoutEffect(() => {
    latestFocusPanel.current = focusPanel;
  });
  const target = useMemo<InsightsNavigationTarget>(
    () => ({
      sessionId,
      panels,
      focusPanel: (panel: SessionPanel) => latestFocusPanel.current(panel),
    }),
    [sessionId, panels],
  );
  return (
    <InsightsNavigationContext.Provider value={target}>
      {children}
    </InsightsNavigationContext.Provider>
  );
}
