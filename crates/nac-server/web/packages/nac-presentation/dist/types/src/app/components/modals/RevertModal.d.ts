interface RevertModalProps {
    open: boolean;
    onClose: () => void;
    sessionId: string;
    /** Snapshot index of the prompt to go back to, or null while closed. */
    messageIdx: number | null;
    /** The prompt itself, so the dialog names the point being restored. */
    prompt: string;
}
/**
 * Confirmation for the one action in the chat that destroys work: the messages
 * after this prompt and the file changes they made are both discarded, and
 * neither comes back.
 */
export declare function RevertModal({ open, onClose, sessionId, messageIdx, prompt }: RevertModalProps): import("react").JSX.Element;
export {};
