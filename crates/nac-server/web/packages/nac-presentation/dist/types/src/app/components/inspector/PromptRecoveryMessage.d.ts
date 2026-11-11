import type { PromptRecovery } from "../../store/promptDraftStore";
export declare function PromptRecoveryMessage({ recovery, hasDraft, onRestore, onDismiss, }: {
    recovery: PromptRecovery;
    hasDraft: boolean;
    onRestore: () => void;
    onDismiss: () => void;
}): import("react").JSX.Element;
