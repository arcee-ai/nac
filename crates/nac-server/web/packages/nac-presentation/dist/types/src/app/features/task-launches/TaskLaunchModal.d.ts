import type { LaunchModelSelection } from "../setup/modelSelection";
export declare function TaskLaunchModal({ projectId, model, defaultRef, onClose, onExistingCheckout, initialPrompt, initialTitle, }: {
    projectId: string;
    model: LaunchModelSelection;
    defaultRef: string | null;
    onClose: () => void;
    onExistingCheckout: () => void;
    /** Home's composer text, carried in as the brief. */
    initialPrompt?: string;
    initialTitle?: string;
}): import("react").JSX.Element;
