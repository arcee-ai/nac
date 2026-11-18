export declare function TaskLaunchModal({ projectId, defaultRef, onClose, onExistingCheckout, initialPrompt, initialTitle, initialGitRef, }: {
    projectId: string;
    defaultRef: string | null;
    onClose: () => void;
    onExistingCheckout: () => void;
    /** Home's composer text, carried in as the brief. */
    initialPrompt?: string;
    initialTitle?: string;
    /** The ref Home's composer chose to start from. */
    initialGitRef?: string;
}): import("react").JSX.Element;
