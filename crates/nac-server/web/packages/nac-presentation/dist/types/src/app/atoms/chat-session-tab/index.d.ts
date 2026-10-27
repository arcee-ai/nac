import type React from "react";
import type { SessionBehavior } from "../../types/api";
interface ChatSessionTabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
    title: string;
    active?: boolean;
    /** Swaps the label for a shimmering one and shows a spinner. */
    running?: boolean;
    /** Display title of the chat this session was forked from. */
    forkedFromTitle?: string | null;
    /** Session type, drawn immediately before the title. */
    behavior?: SessionBehavior | null;
    /** Figma `isNacEnable`: whether the behavior glyph is drawn at all. */
    showBehaviorIcon?: boolean;
    /** Full accessible and hover/focus meaning of the behavior icon. */
    behaviorLabel?: string;
    /** Takes the tab off the strip. The chat itself is untouched. */
    onDismiss?: () => void;
}
/** Tab-shaped stand-in while the project's chats have not arrived yet. */
export declare function ChatSessionTabSkeleton({ className }: {
    className?: string;
}): React.JSX.Element;
/**
 * One session in the tab strip above a project's transcript. Its owner decides
 * the available width so the atom can serve fixed previews and a flexible
 * project strip alike. The underline on the active one is the only thing
 * marking it as selected. A fork shows the scheme glyph in front until the chat
 * is running, when the loader takes that slot.
 *
 * Pointing at or focusing a tab reveals its close control. The tab reserves that
 * room only while the control is visible, so it cannot cover the behavior icon
 * or title and untouched tabs still show as much of their name as possible.
 * Renaming lives in the chat list, where there is room to say what the button
 * does.
 */
declare const ChatSessionTab: React.FC<ChatSessionTabProps>;
export default ChatSessionTab;
