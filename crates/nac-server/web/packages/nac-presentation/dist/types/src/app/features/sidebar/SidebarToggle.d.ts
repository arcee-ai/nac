/**
 * "Show sidebar": renders only while the sidebar is hidden on a width that has
 * one, so any page header can always include it and never shows a dead
 * control. (Session header: place it first in the 52px header row.)
 */
export declare function SidebarToggle({ className }: {
    className?: string;
}): import("react").JSX.Element | null;
