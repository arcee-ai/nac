/** Which half of a thread the detail pane is showing. */
export type ThreadDetailView = "log" | "overview";
/**
 * Phone form of the switch: pills floating over the view they change, since the
 * box header at that width is already full. The phone's dialog title has no
 * room for the task the wider headers carry beside the thread name, so it rides
 * along here as a third pill — one that opens a sheet instead of swapping the
 * view, and so takes only the width of its own word rather than an equal share.
 */
export declare function ViewPills({ view, action, canSteer, onSteer, onChange, }: {
    view: ThreadDetailView;
    /** What the open thread was asked to do, if the dispatch is known. */
    action: string;
    canSteer: boolean;
    onSteer: () => void;
    onChange: (view: ThreadDetailView) => void;
}): import("react").JSX.Element;
/**
 * Compact Command Log / Overview pills for the desktop detail header. They are
 * toggle buttons rather than tabs, so the set is a named group.
 */
export declare function ViewSwitcher({ view, onChange, }: {
    view: ThreadDetailView;
    onChange: (view: ThreadDetailView) => void;
}): import("react").JSX.Element;
/** Tablet form of the same switch, trailing the panel's own header row. */
export declare function ThreadViewSelect({ view, onChange, }: {
    view: ThreadDetailView;
    onChange: (view: ThreadDetailView) => void;
}): import("react").JSX.Element;
