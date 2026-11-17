import { Sidebar } from "@/app/features/sidebar/Sidebar";

export { SIDEBAR_WIDTH } from "@/app/features/sidebar/useSidebar";

/**
 * The app's navigation sidebar (Focus): see `features/sidebar/Sidebar.tsx`.
 * `variant` is accepted for existing route owners; every page now shows the
 * same sidebar.
 */
export function LeftSidebar(_props: { variant?: "session" | "projects" }) {
  return <Sidebar />;
}
