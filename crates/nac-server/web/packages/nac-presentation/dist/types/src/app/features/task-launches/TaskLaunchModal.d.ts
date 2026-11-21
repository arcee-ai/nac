import type { LaunchModelSelection } from "../setup/modelSelection";
import type { ModelOverride } from "../home/modelChoice";
export declare function TaskLaunchModal({ projectId, model, modelSource, defaultRef, onClose, onExistingCheckout, onLaunchAccepted, validateModel, initialPrompt, initialTitle, initialGitRef, }: {
    projectId: string;
    model: LaunchModelSelection;
    modelSource?: ModelOverride["source"];
    defaultRef: string | null;
    onClose: () => void;
    onExistingCheckout: (prompt: string) => void;
    onLaunchAccepted?: () => void;
    validateModel?: (signal: AbortSignal) => Promise<void>;
    /** Home's composer text, carried in as the brief. */
    initialPrompt?: string;
    initialTitle?: string;
    /** The ref Home's composer chose to start from. */
    initialGitRef?: string;
}): import("react").JSX.Element;
