import type React from "react";
import type { SessionBehavior, SessionLineage } from "../../types/api";
interface ChatSessionButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
    title: string;
    active?: boolean;
    /** Swaps the leading slot for the model loader and shimmers the title. */
    running?: boolean;
    /** Session type, drawn in the leading slot. */
    behavior?: SessionBehavior | null;
    /** A delegated session's relationship, which decides over its behavior. */
    lineage?: SessionLineage["kind"] | null;
    /** Figma `isNacEnable`: whether the behavior glyph is drawn at all. */
    showBehaviorIcon?: boolean;
    /** Full accessible and hover meaning of the behavior icon. */
    behaviorLabel?: string;
    /** Display title of the chat this session was forked from. */
    forkedFromTitle?: string | null;
    /** Compact text after the title, such as a status or a project. */
    badge?: string;
    /** Full accessible meaning of the compact badge. */
    badgeLabel?: string;
    /** Authoritative server activity is newer than the browser's viewed marker. */
    unread?: boolean;
    /** Taller touch target and always-visible actions for the mobile modal. */
    isMobile?: boolean;
    /** Pin, rename and delete controls, revealed on hover and on keyboard focus. */
    actions?: React.ReactNode;
}
/**
 * One session as a list row.
 *
 * The leading slot holds the behavior glyph, or the model loader while the
 * session runs; the loader shows even where the glyph is hidden, and without
 * either the title starts at the padding. A fork adds the scheme mark after
 * the title.
 *
 * Press, focus and disabled styles key off the row button rather than the row,
 * so pressing or focusing an action neither presses the row nor rings it. The
 * actions live outside the button so they stay clickable. On desktop they
 * leave the layout until the row is hovered or focused from the keyboard, so
 * the title keeps the full row until then. They are visually hidden rather
 * than removed: focus leaves the row before it reaches the first action, and
 * a removed action could not take it.
 */
declare const ChatSessionButton: React.FC<ChatSessionButtonProps>;
export default ChatSessionButton;
