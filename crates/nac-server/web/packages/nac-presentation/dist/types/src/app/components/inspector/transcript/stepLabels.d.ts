import type { ActionStatus, InsightSegment, ModelTurnItem } from "../../../features/insights/model/types";
/** What one fold row says: a verb, the argument it acted on, and how long it took. */
export interface StepLabel {
    verb: string;
    /** Path, command, pattern or host; null when the call has none worth naming. */
    argument: string | null;
    /** Full argument for the row's tooltip, when the shown one is shortened. */
    title: string | null;
    duration: string | null;
    status: ActionStatus;
}
/** The row a fold draws for one step. */
export declare function stepLabel(segment: InsightSegment): StepLabel;
/**
 * What the live status line says about a running turn, read off whatever it
 * produced last: its newest step, a subagent it is starting, or the prose it is writing.
 */
export declare function liveTurnLabel(items: readonly ModelTurnItem[]): string;
/**
 * What the live status line says about the newest step: "Reading index.tsx…",
 * "Running npm test…", "Thinking…".
 */
export declare function liveStepLabel(segment: InsightSegment | undefined): string;
