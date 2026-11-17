import { type ReactNode } from "react";
/**
 * One owner for settings destinations and the bounded native navigation
 * adapter. Settings destinations are pages (`/settings/:section`); session
 * panels stay inside the session already on screen.
 */
export declare function ProductNavigationProvider({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
