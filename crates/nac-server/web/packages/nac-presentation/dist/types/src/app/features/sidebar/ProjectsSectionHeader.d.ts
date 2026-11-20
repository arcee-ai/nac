import type { ReactNode } from "react";
/** The "Projects" heading over the sidebar's project groups: folds the list and adds a project. */
export declare function ProjectsSectionHeader({ expanded, touch, onToggle, children, }: {
    expanded: boolean;
    touch?: boolean;
    onToggle: () => void;
    children: ReactNode;
}): import("react").JSX.Element;
