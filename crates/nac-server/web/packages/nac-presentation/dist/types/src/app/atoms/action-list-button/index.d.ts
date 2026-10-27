import type React from "react";
import { IconName } from "../icon";
export declare enum ActionListButtonStatus {
    Ready = "ready",
    Pending = "pending",
    Running = "running",
    Failed = "failed"
}
interface ActionListButtonProps {
    /**
     * Type icon, shown while Ready. The other statuses bring their own glyph,
     * and a group row shows its disclosure chevron in every status instead.
     */
    icon: IconName;
    label: string;
    /** Rendered uppercase. Running and Failed rows drop it. */
    meta?: string;
    status?: ActionListButtonStatus;
    /** Leave unset on rows that navigate away instead of selecting themselves. */
    selected?: boolean;
    /** Only for group rows, which expand and collapse their children. */
    expanded?: boolean;
    onClick?: () => void;
    className?: string;
}
/**
 * One row of the Insights list: a thread, a session, a tool call or a group of
 * them. The caller maps the action type to icon, label and meta; the row only
 * knows its status. It is a small `TabButton`, so hover, press, focus and the
 * selected highlight are the tab button's own. `.btn-small.btn-icon` sets its
 * height and padding in unlayered CSS, which the 28px row overrides with `!`.
 */
declare const ActionListButton: React.FC<ActionListButtonProps>;
/**
 * The child rows of an expanded group, or the threads of one wave, behind a
 * single guide line that runs 4px past the first and the last row. The rows
 * sit 8px in from the line's outer edge, the 1px line included.
 */
export declare function ActionListSegment({ children, className, }: {
    children: React.ReactNode;
    className?: string;
}): React.JSX.Element;
export default ActionListButton;
