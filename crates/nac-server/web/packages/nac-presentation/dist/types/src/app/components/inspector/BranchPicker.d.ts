import { PopoverPlacement } from "../../atoms";
/**
 * The branch chip in the session header, opening a list of local branches with an
 * escape hatch for making a new one. Switching is refused while an agent could
 * be working in the checkout; the server enforces the same rules, because
 * another session may share this directory.
 */
export declare function BranchPicker({ sessionId, branch, placement, }: {
    sessionId: string;
    branch: string;
    /** Footer chips open upward. A header chip opens downward. */
    placement?: PopoverPlacement;
}): import("react").JSX.Element;
