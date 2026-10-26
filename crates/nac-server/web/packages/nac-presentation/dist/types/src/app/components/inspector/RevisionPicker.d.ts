import { PopoverPlacement } from "../../atoms";
/**
 * The snapshot chip in the session header, switching the panels between the live
 * working tree and the checkout as it stood at the end of an earlier run.
 *
 * Nothing here writes: picking a revision only changes what is read, so it is
 * safe during a run and needs none of the guards the branch picker carries.
 */
export declare function RevisionPicker({ sessionId, selected, onSelect, placement, }: {
    sessionId: string;
    selected: number | null;
    onSelect: (revision: number | null) => void;
    /** Footer chips open upward. A header chip opens downward. */
    placement?: PopoverPlacement;
}): import("react").JSX.Element;
