import type { SelectionQuestion } from "../../types/api";
export interface SelectionReviewDraft {
    /** Transcript index of the reply the excerpt came from. */
    messageIndex: number;
    excerpt: string;
    question: string;
    /** Why the review cannot be sent, or why the last attempt failed. */
    error: string | null;
    /** The last send's outcome is unknown; Ask resends the same request key. */
    uncertain: boolean;
    /** The selection itself cannot be asked about; only Discard applies. */
    blocked: boolean;
    sending: boolean;
}
interface Props {
    review: SelectionReviewDraft | null;
    questions: SelectionQuestion[];
    cancelingId: string | null;
    onQuestionChange: (question: string) => void;
    onAsk: () => void;
    onDiscard: () => void;
    onCancel: (questionId: string) => void;
    onClose: () => void;
}
/**
 * A compact pane beside the chat: review a selected excerpt, ask one
 * question about it, and read attributed answers. Nothing here sends input
 * to the chat itself.
 */
export declare function SelectionQuestionPane({ review, questions, cancelingId, onQuestionChange, onAsk, onDiscard, onCancel, onClose, }: Props): import("react").JSX.Element;
export {};
