/**
 * The project list behind the trail's project button: every project plus the
 * sessions that belong to none, the open one marked.
 *
 * Rendered as the body of a popover, which is what `onClose` closes — an action
 * that opens a modal of its own closes it first, so the two do not stack.
 */
export declare function ProjectPopover({ activeId, onClose, }: {
    /** Open project, or the session id when an unassigned session is open. */
    activeId: string | null;
    onClose: () => void;
}): import("react").JSX.Element;
