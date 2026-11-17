import { type WorkFold } from "./foldLayout";
/**
 * Everything a turn did on its way to the answer, folded behind one quiet
 * line: "Worked for 1m 12s · Read 4 files, ran 2 commands". The chevron opens
 * it in place into one row per step, and each row opens into what it did.
 *
 * Compact density keeps it folded, detailed opens it; a toggle by the reader
 * wins over both. Failed steps and steps waiting for approval are never
 * folded away: they stay listed under the line whatever the fold says.
 */
export declare const WorkFoldView: import("react").MemoExoticComponent<({ fold, active, turnDurationMs, selectedGroupId, interactive, }: {
    fold: WorkFold;
    /** The turn is still producing output. */
    active: boolean;
    /** Wall-clock time of the run behind the turn, once it finished. */
    turnDurationMs: number | null;
    /** The Insights group the panels point at, if it is one of these. */
    selectedGroupId: string | null;
    interactive: boolean;
}) => import("react").JSX.Element>;
