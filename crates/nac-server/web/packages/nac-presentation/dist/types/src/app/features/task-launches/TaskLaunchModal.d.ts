export declare function TaskLaunchModal({ projectId, defaultRef, onClose, onExistingCheckout, initialPrompt, initialTitle, }: {
    projectId: string;
    defaultRef: string | null;
    onClose: () => void;
    onExistingCheckout: () => void;
    /** Home's composer text, carried in as the brief. */
    initialPrompt?: string;
    initialTitle?: string;
}): import("react").JSX.Element;
