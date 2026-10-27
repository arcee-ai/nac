import { type ReactNode } from "react";
import { type InsightsNavigationTarget } from "./useInsightsNavigation";
/**
 * Lends the session page's id, panels and `focusPanel` to
 * `useInsightsNavigation`. The value changes only with the session and its
 * panels: the page hands over a new `focusPanel` on every render, and the
 * transcript rows that read this context must not re-render with it. It also
 * carries a keyboard pick across to the Insights detail, which takes the focus
 * once it shows that pick.
 */
export declare function InsightsNavigationProvider({ sessionId, panels, focusPanel, children, }: InsightsNavigationTarget & {
    children: ReactNode;
}): import("react").JSX.Element;
