import type { InsightGroup, InsightSegment, ModelTurnItem } from "./types";
import { type ModelTurn, type TranscriptTurn } from "../../../lib/transcript";
/** Anchor of a model turn that comes before every turn of the loaded window. */
export declare const LEADING_ANCHOR = "insights-leading";
/**
 * Key the Insights ids of a model turn hang off: the user prompt or delegated
 * completion right before it. `ModelTurn.key` cannot serve, since it moves to
 * the newest message whenever a tool round is appended.
 *
 * A streamed turn after another model turn answers a prompt the snapshot does
 * not show yet, so the turn before it is the previous run's. It gets the
 * provisional `STREAMING_TURN_KEY` instead, which gives way to the prompt's
 * key once the prompt lands: the one point at which its ids change.
 */
export declare function insightAnchor(turn: ModelTurn, previous: TranscriptTurn | undefined): string;
export declare function createInsightGroup(id: string, segments: readonly InsightSegment[]): InsightGroup;
/**
 * One model turn as groups of consecutive reasoning, tool and workset blocks,
 * the sessions it launched, and the text and wave blocks between them, in
 * transcript order. `previous` is the turn before it in the same `turns`.
 *
 * Group ids are `<anchor>:<first segment key>` and session ids
 * `<anchor>:<block key>` (see `insightAnchor`), so they hold while the turn
 * grows and across the commit of streamed output.
 *
 * Turns must be treated as immutable: results are cached per turn object, so
 * only a turn that was rebuilt is partitioned again.
 */
export declare function partitionModelTurn(turn: ModelTurn, previous: TranscriptTurn | undefined): readonly ModelTurnItem[];
