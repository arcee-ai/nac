import type React from "react";
export declare enum ChatSessionMessageVariant {
    Info = "info",
    Error = "error",
    Danger = "danger",
    Success = "success"
}
export type ChatSessionMessageAction = {
    label: string;
    onClick: () => void;
} | {
    label: string;
    href: string;
};
interface ChatSessionMessageProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    title: React.ReactNode;
    variant?: ChatSessionMessageVariant;
    /** Optional second line explaining the title. */
    children?: React.ReactNode;
    /** Optional way out of whatever the message reports. */
    action?: ChatSessionMessageAction;
}
/**
 * What the transcript says when something happened to the run rather than in
 * it: a quiet surface card whose hairline and title carry its signal — red
 * failed, amber needs you, green done, neutral information — so it is seen
 * without shouting.
 */
declare const ChatSessionMessage: React.FC<ChatSessionMessageProps> & {
    Variant: typeof ChatSessionMessageVariant;
};
export default ChatSessionMessage;
