/** Remounted on every open so the form always starts from the configured defaults. */
export declare function CreateProjectModal({ open, onClose, initialMode, }: {
    open: boolean;
    onClose: () => void;
    initialMode?: "local" | "ssh";
}): import("react").JSX.Element | null;
