interface ProjectsEmptyStateProps {
    /** Opens the new-project dialog. */
    onStart: () => void;
    onAddRepository?: () => void;
    onManagedSettings?: () => void;
    modelReady?: boolean;
    githubConnected?: boolean;
    mobile: boolean;
}
/**
 * Shown in place of the whole list — rail and search bar included — while the
 * account has no projects and no loose chats, which is how the design frames
 * the state at every width. A filtered-away list keeps the regular chrome
 * instead.
 */
export declare function ProjectsEmptyState({ onStart, onAddRepository, onManagedSettings, modelReady, githubConnected, mobile, }: ProjectsEmptyStateProps): import("react").JSX.Element;
export {};
