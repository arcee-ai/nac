/** Which half of a thread the detail pane is showing. */
export type ThreadDetailView = "log" | "overview";
/**
 * Logs / Overview tabs for the desktop detail header. They are toggle buttons
 * rather than tabs, so the set is a named group.
 */
export declare function ViewSwitcher({ view, onChange, }: {
    view: ThreadDetailView;
    onChange: (view: ThreadDetailView) => void;
}): import("react").JSX.Element;
/**
 * The same switch as a select: trailing the panel's header row on a tablet,
 * and floating over the foot of the view on a phone.
 */
export declare function ThreadViewSelect({ view, onChange, floating, }: {
    view: ThreadDetailView;
    onChange: (view: ThreadDetailView) => void;
    floating?: boolean;
}): import("react").JSX.Element;
