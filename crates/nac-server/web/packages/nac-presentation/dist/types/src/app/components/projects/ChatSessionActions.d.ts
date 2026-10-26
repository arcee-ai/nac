interface ChatSessionActionsProps {
    title: string;
    pinned?: boolean;
    /**
     * Medium buttons with 20px glyphs for the mobile row. Desktop stays small:
     * its 24px target is the WCAG 2.5.8 minimum.
     */
    isMobile?: boolean;
    onPin?: () => void;
    onRename?: () => void;
    onDelete?: () => void;
}
/** Shared row actions; callers choose whether pinning is server or browser presentation. */
export declare function ChatSessionActions({ title, pinned, isMobile, onPin, onRename, onDelete, }: ChatSessionActionsProps): import("react").JSX.Element;
export {};
