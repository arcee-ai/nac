/**
 * The Inbox: what needs you (oldest first), then failed and finished work you
 * have not opened. Navigate only — decisions are made on the session's own
 * attention card, at the exact request. j/k move, Enter opens.
 */
export declare function InboxList({ touch, onOpened }: {
    touch?: boolean;
    onOpened?: () => void;
}): import("react").JSX.Element;
