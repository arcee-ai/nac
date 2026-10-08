import type React from "react";
import { IconName } from "../icon";
interface ChatSessionButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
    title: string;
    active?: boolean;
    /** Shimmers the title while the session is running. The mode icon stays. */
    running?: boolean;
    /** Session mode glyph. A direct agent is a plane. */
    icon?: IconName;
    /** Display title of the chat this session was forked from. */
    forkedFromTitle?: string | null;
    /** Compact identity shown after the title, such as the session behavior. */
    badge?: string;
    /** Full accessible meaning of the compact badge. */
    badgeLabel?: string;
    /** Authoritative server activity is newer than the browser's viewed marker. */
    unread?: boolean;
    /** Taller touch target and always-visible actions for the mobile modal. */
    isMobile?: boolean;
    /** Rename and delete controls, revealed on hover and on keyboard focus. */
    actions?: React.ReactNode;
}
/**
 * One session as a list row, used by the chat popover and the mobile modal.
 *
 * The row leads with the session-mode icon. A fork keeps the scheme glyph
 * after the title, including while the chat is running.
 *
 * The actions live outside the button so they stay clickable. On desktop they
 * leave the layout until the row is hovered or focused from the keyboard, so
 * the title keeps the full row until then.
 */
declare const ChatSessionButton: React.FC<ChatSessionButtonProps>;
export default ChatSessionButton;
