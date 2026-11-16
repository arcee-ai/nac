interface ChatSessionActionsProps {
    title: string;
    pinned?: boolean;
    /**
     * 44px phone targets with a shared narrow-screen action layout. Desktop keeps a 24px target; it
     * is the WCAG 2.5.8 minimum.
     */
    isMobile?: boolean;
    onPin?: () => void;
    onRename?: () => void;
    onDelete?: () => void;
}
/** Shared row actions; callers choose whether pinning is server or browser presentation. */
export declare function ChatSessionActions({ title, pinned, isMobile, onPin, onRename, onDelete, }: ChatSessionActionsProps): import("react").JSX.Element;
export {};
