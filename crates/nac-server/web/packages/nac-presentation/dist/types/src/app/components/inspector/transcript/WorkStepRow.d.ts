import type { WorkStep } from "./foldLayout";
/**
 * One step of a turn's work: a 16px glyph, one line naming what it did, and
 * how long it took. A step with something to show opens it in place: the
 * reasoning it wrote, or what its tool call returned.
 */
export declare const WorkStepRow: import("react").MemoExoticComponent<({ step, streaming, interactive, choiceKey, }: {
    step: WorkStep;
    /** The turn is live, so reasoning may still be arriving. */
    streaming: boolean;
    interactive: boolean;
    choiceKey?: string;
}) => import("react").JSX.Element>;
