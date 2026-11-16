import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import {
  InsightsNavigationContext,
  type InsightsNavigationTarget,
} from "@/app/features/insights/useInsightsNavigation";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { SessionPanel } from "@/app/lib/routes";
import type { InsightSelection } from "@/app/store/sessionLayoutStore";

/**
 * Lends the session page's id, panels and `focusPanel` to
 * `useInsightsNavigation`. The value changes only with the session and its
 * panels: the page hands over a new `focusPanel` on every render, and the
 * transcript rows that read this context must not re-render with it. It also
 * carries a keyboard pick across to the Insights detail, which takes the focus
 * once it shows that pick.
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
  const { sessionLayoutStore } = useNativeRuntime().stores.sessionLayoutStore;
  // Focus intent belongs to this exact parent and presentation lifetime too.
  const { detailFocusRef, returnFocusRef } = useMemo(
    () => ({
      sessionId,
      sessionLayoutStore,
      detailFocusRef: { current: null as InsightSelection | null },
      returnFocusRef: { current: false },
    }),
    [sessionId, sessionLayoutStore],
  );
  const target = useMemo(
    () => ({
      sessionId,
      panels,
      focusPanel: (panel: SessionPanel) => latestFocusPanel.current(panel),
      detailFocusRef,
      returnFocusRef,
    }),
    [sessionId, panels, detailFocusRef, returnFocusRef],
  );
  return (
    <InsightsNavigationContext.Provider value={target}>
      {children}
    </InsightsNavigationContext.Provider>
  );
}
