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
    /** Optional way out of whatever the message reports. */
    action?: {
        label: string;
        onClick: () => void;
    };
}
/**
 * What the transcript says when something happened to the run rather than in
 * it. Unlike `MessageBox` it carries no surface of its own — a coloured rule
 * down the left is the whole frame, so it reads as part of the conversation.
 */
declare const ChatSessionMessage: React.FC<ChatSessionMessageProps> & {
    Variant: typeof ChatSessionMessageVariant;
};
export default ChatSessionMessage;
