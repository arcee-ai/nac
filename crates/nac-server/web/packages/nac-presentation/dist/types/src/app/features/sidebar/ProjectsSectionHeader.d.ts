/** The "Projects" heading over the sidebar's project groups: folds the list and adds a project. */
export declare function ProjectsSectionHeader({ expanded, touch, createLabel, onToggle, onCreate, }: {
    expanded: boolean;
    touch?: boolean;
    createLabel: string;
    onToggle: () => void;
    onCreate: () => void;
}): import("react").JSX.Element;
