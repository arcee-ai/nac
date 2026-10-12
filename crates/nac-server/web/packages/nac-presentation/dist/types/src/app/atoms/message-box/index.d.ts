import type React from "react";
export declare enum MessageBoxVariant {
    Info = "info",
    Error = "error",
    Danger = "danger",
    Success = "success"
}
export declare enum MessageBoxSize {
    Small = "small",
    Medium = "medium",
    Large = "large"
}
interface MessageBoxProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    title?: React.ReactNode;
    variant?: MessageBoxVariant;
    size?: MessageBoxSize;
}
/** Inline notice tied to the surrounding content, as opposed to a toast. */
declare const MessageBox: React.FC<MessageBoxProps> & {
    Variant: typeof MessageBoxVariant;
    Size: typeof MessageBoxSize;
};
export default MessageBox;
