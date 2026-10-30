import type React from "react";
export declare enum ChatSessionMessageVariant {
    Info = "info",
    Error = "error",
    Danger = "danger",
    Success = "success"
}
interface ChatSessionMessageProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    title: React.ReactNode;
    variant?: ChatSessionMessageVariant;
    /** Optional second line explaining the title. */
    children?: React.ReactNode;
    /** Raw detail behind the message, folded under a "Diagnostic" toggle. */
    diagnostic?: React.ReactNode;
    /** Optional way out of whatever the message reports. */
    action?: {
        label: string;
        onClick: () => void;
    };
}
/**
 * What the transcript says when something happened to the run rather than in
 * it: a rounded card tinted with its variant's colour, so it stands apart from
 * the conversation without the weight of a bordered `MessageBox`.
 *
 * A folded diagnostic stays in the document while hidden, so the alert's text
 * still carries it for assistive technology and copy-paste.
 */
declare const ChatSessionMessage: React.FC<ChatSessionMessageProps> & {
    Variant: typeof ChatSessionMessageVariant;
};
export default ChatSessionMessage;
