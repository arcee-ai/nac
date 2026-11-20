/** A local display choice only: it never retries or changes the transcript. */
export declare function UnconfirmedPromptNotice({ visible, onDismiss, canDismiss, }: {
    visible: boolean;
    onDismiss: () => void;
    canDismiss?: boolean;
}): import("react").JSX.Element | null;
/** Bind the recovery action to the exact current session and submission. */
export declare function UnconfirmedPromptRecovery({ sessionId, showPending, running, token, }: {
    sessionId: string;
    showPending: boolean;
    running: boolean;
    token: number | null;
}): import("react").JSX.Element;
