interface ProjectsEmptyStateProps {
    /** Opens the new-project dialog. */
    onStart: () => void;
    launchFolder?: string;
    launchFolderPending?: boolean;
    launchFolderError?: string | null;
    onUseLaunchFolder?: () => void;
    onAddRepository?: () => void;
    onManagedSettings?: () => void;
    modelReady?: boolean;
    githubConnected?: boolean;
    mobile: boolean;
}
/**
 * Home with no projects and no loose sessions: one calm "Add a project" card.
 * Managed hosts lead with "Add repository" and show what is ready.
 */
export declare function ProjectsEmptyState({ onStart, launchFolder, launchFolderPending, launchFolderError, onUseLaunchFolder, onAddRepository, onManagedSettings, modelReady, githubConnected, mobile, }: ProjectsEmptyStateProps): import("react").JSX.Element;
export {};
