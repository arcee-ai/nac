interface ChatSessionActionsProps {
    title: string;
    pinned?: boolean;
    onPin?: () => void;
    onRename?: () => void;
    onDelete?: () => void;
}
/** Shared row actions; callers choose whether pinning is server or browser presentation. */
export declare function ChatSessionActions({ title, pinned, onPin, onRename, onDelete, }: ChatSessionActionsProps): import("react").JSX.Element;
export {};
