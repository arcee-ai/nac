import type { TerminalSelectionEvidence } from "../../types/api";
interface UserMessageProps {
    text: string;
    terminalSelection?: TerminalSelectionEvidence;
    sessionId?: string;
    pending?: boolean;
    /**
     * Skills the stored message had expanded into the agent-facing prompt,
     * parsed from its invoked_skills wrapper. Shown as a small line under the
     * bubble so the injection is visible; null for an ordinary prompt.
     */
    invokedSkills?: string[] | null;
    /**
     * Shown when the transcript has no time of its own for the message. The
     * transcript's time for `messageIndex` wins, in the chat's English format.
     */
    timestamp?: string | null;
    /**
     * Raw snapshot index the actions address. Absent while the message is still
     * only in flight, which is what disables the revert affordance.
     */
    messageIndex?: number;
    /**
     * Answer this prompt again, discarding whatever reply it already produced.
     * Only for the newest prompt — older turns keep revert + copy only — and it
     * is the newest prompt's own bubble that carries the action when a failed run
     * left it unanswered.
     *
     * The handlers take the message they act on rather than closing over it, so
     * the transcript can pass the same function to every bubble and let the
     * memoized rows skip a render.
     */
    onRefresh?: ((messageIndex: number) => void) | null;
    /** Restore the session to the snapshot at this prompt. */
    onRevert?: ((messageIndex: number, text: string) => void) | null;
    /** Disable destructive / network actions while a run is in flight. */
    actionsDisabled?: boolean;
    /** Parent-owned delegated transcripts expose copy/time but no mutation affordances. */
    readOnly?: boolean;
}
/** The prompt bubble. Pending ones are dimmed until the snapshot catches up. */
export declare const UserMessage: import("react").MemoExoticComponent<({ timestamp, ...props }: UserMessageProps) => import("react").JSX.Element>;
export {};
