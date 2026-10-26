import { PopoverPlacement } from "../../atoms";
/**
 * The branch button in the session header, opening a list of local branches
 * with an escape hatch for making a new one. Switching is refused while an
 * agent could be working in the checkout; the server enforces the same rules,
 * because another session may share this directory.
 */
export declare function BranchPicker({ sessionId, branch, placement, tertiary, labelClassName, iconClassName, }: {
    sessionId: string;
    branch: string;
    /** Footer chips open upward. A header chip opens downward. */
    placement?: PopoverPlacement;
    /**
     * The desktop session header draws a borderless tertiary button. The phone
     * dialog title keeps the padded chip, the bigger target for a finger.
     */
    tertiary?: boolean;
    /** Classes for the tertiary button's branch name; its accessible name stays. */
    labelClassName?: string;
    /** Classes for the tertiary button's branch icon. */
    iconClassName?: string;
}): import("react").JSX.Element;
