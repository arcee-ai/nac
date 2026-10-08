import type React from "react";
export declare enum ChatLoaderSize {
    Small = "w-1.5 h-1.5",
    Medium = "w-2 h-2",
    Large = "w-3 h-3"
}
interface ChatLoaderProps {
    size?: ChatLoaderSize;
    className?: string;
}
/**
 * Three bouncing dots for the gap between sending a message and the first
 * word of the answer, where a spinner would suggest a stuck request.
 */
declare const ChatLoader: React.FC<ChatLoaderProps> & {
    Size: typeof ChatLoaderSize;
};
export default ChatLoader;
