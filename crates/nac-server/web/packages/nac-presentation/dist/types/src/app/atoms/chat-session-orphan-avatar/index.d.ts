import type React from "react";
interface ChatSessionOrphanAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
    size?: number;
    /** Pulses the glyph while the chat has a run going. */
    isRunning?: boolean;
}
/**
 * Stand-in avatar for a chat that belongs to no project. Projects and assigned
 * chats get an identicon seeded from their id; an unassigned chat has nothing to
 * seed one from that would mean anything, so it gets a neutral chat glyph in a
 * tile of the same footprint.
 */
declare const ChatSessionOrphanAvatar: React.FC<ChatSessionOrphanAvatarProps>;
export default ChatSessionOrphanAvatar;
