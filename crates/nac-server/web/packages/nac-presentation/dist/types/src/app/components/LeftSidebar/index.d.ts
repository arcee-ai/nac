export { SIDEBAR_WIDTH } from "../../features/sidebar/useSidebar";
/**
 * The app's navigation sidebar (Focus): see `features/sidebar/Sidebar.tsx`.
 * `variant` is accepted for existing route owners; every page now shows the
 * same sidebar.
 */
export declare function LeftSidebar(_props: {
    variant?: "session" | "projects";
}): import("react").JSX.Element;
