import type React from "react";
import { cn } from "../../lib/cn";

export enum ChatLoaderSize {
  Small = "w-1.5 h-1.5",
  Medium = "w-2 h-2",
  Large = "w-3 h-3",
}

interface ChatLoaderProps {
  size?: ChatLoaderSize;
  className?: string;
}

/**
 * Three bouncing dots for the gap between sending a message and the first
 * word of the answer, where a spinner would suggest a stuck request.
 */
const ChatLoader: React.FC<ChatLoaderProps> & { Size: typeof ChatLoaderSize } = ({
  size = ChatLoaderSize.Medium,
  className = "",
}) => (
  <div
    role="status"
    aria-label="Waiting for a response"
    className={cn("flex items-end gap-1 fade", className)}
  >
    {[0, 1, 2].map((index) => (
      <span
        key={index}
        className={cn(
          "chat-loader-dot rounded-full bg-divider-secondary",
          size,
        )}
      />
    ))}
  </div>
);

ChatLoader.Size = ChatLoaderSize;

export default ChatLoader;
