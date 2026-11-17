import type { ActionStatus, InsightSegment, InsightSessionEntry, ModelTurnBlock, ModelTurnItem } from "../../../features/insights/model/types";
/**
 * One line of the work a turn did on its way to the answer: a step from one of
 * its groups, or prose the model wrote between two of them.
 */
export type WorkStep = {
    kind: "segment";
    key: string;
    groupId: string;
    segment: InsightSegment;
} | {
    kind: "note";
    key: string;
    text: string;
};
/** What a turn did before its answer, folded behind one line. */
export interface WorkFold {
    kind: "fold";
    key: string;
    /** Ids of the Insights groups folded in, oldest first. */
    groupIds: string[];
    steps: WorkStep[];
}
/** A turn as the transcript lays it out: the fold where its work began, then everything else. */
export type TurnLayoutItem = WorkFold | InsightSessionEntry | {
    kind: "session-group";
    key: string;
    entries: InsightSessionEntry[];
} | {
    kind: "block";
    key: string;
    block: ModelTurnBlock;
};
/**
 * Lays a partitioned model turn out as the transcript shows it. Reasoning and
 * tool groups fold at the place the first of them appeared, and
 * so does prose the model wrote between them ("Let me look at the tests").
 * Launched sessions, thread waves and the prose after the last group stay in
 * the open, in their order: they are what the turn has to say.
 */
export declare function layoutModelTurn(items: readonly ModelTurnItem[]): TurnLayoutItem[];
export declare function foldSegments(fold: WorkFold): InsightSegment[];
/** A step that must stay on screen whatever the fold or the density says. */
export declare function isPinnedStatus(status: ActionStatus): boolean;
export declare function stepStatus(step: WorkStep): ActionStatus;
/**
 * The fold's sentence: "Read 4 files, ran 2 commands". At most four intents
 * are named; any beyond them are only counted.
 */
export declare function workSentence(segments: readonly InsightSegment[]): string;
/** Compact wall-clock duration: "<1s", "4.2s", "12s", "1m 12s", "1h 4m". */
export declare function formatWorkDuration(ms: number | null | undefined): string | null;
/** Running clock: "0:07", "12:40", "1:02:03". */
export declare function formatElapsed(ms: number): string;
/**
 * The fold's line once the turn has settled: "Worked for 1m 12s · Read 4
 * files, ran 2 commands". A turn that only reasoned "Thought for 8s".
 */
export declare function settledFoldLabel(segments: readonly InsightSegment[], turnDurationMs: number | null): string;
/** The fold's line while the turn is still producing output. */
export declare function liveFoldLabel(segments: readonly InsightSegment[]): string;
