import type React from "react";
interface ChatSessionLeadingMarkProps {
    /** Display title of the chat this session was forked from. */
    forkedFromTitle?: string | null;
    running?: boolean;
    /** Text color tokens, matching the title beside the mark. */
    className?: string;
}
/**
 * Leading slot on a tab or list row: a fork glyph with a desktop tooltip, or
 * the run loader in the same place. Running always wins — the spinner replaces
 * the fork icon, matching the Figma `isFork` / `Running` matrix.
 */
declare const ChatSessionLeadingMark: React.FC<ChatSessionLeadingMarkProps>;
export default ChatSessionLeadingMark;
