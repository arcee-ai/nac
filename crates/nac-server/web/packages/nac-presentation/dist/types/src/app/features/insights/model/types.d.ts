import type { ToolPresentation } from "../../../lib/toolPresentation";
import type { TranscriptBlock, TranscriptThread } from "../../../lib/transcript";
/** What an Insights row stands for; picks its icon, labels and meta. */
export type ActionKind = "reasoning" | "thread" | "define-workset" | "delete-thread" | "read-file" | "write-file" | "edit-file" | "glob" | "grep" | "run-command" | "write-command" | "read-command-output" | "web-search" | "web-fetch" | "create-goal" | "get-goal" | "update-goal" | "spawn-agent" | "spawn-orchestrator" | "session-status" | "session-steer" | "session-read" | "session-wait" | "session-cancel" | "other";
export type SpawnActionKind = Extract<ActionKind, "spawn-agent" | "spawn-orchestrator">;
export type ActionStatus = "ready" | "pending" | "running" | "failed";
export type InsightSegment = {
    kind: "reasoning";
    /** Key of the transcript block, unique within its model turn. */
    key: string;
    text: string;
    durationMs: number | null;
    streaming: boolean;
} | {
    kind: "tool";
    key: string;
    /** Transport tool name. */
    name: string;
    action: ActionKind;
    /** Null for the compact tool blocks of orchestrator sessions. */
    presentation: ToolPresentation | null;
    /** The call has no outcome yet. */
    pending: boolean;
} | {
    kind: "workset";
    key: string;
    worksetId: string;
    pending: boolean;
};
export interface InsightGroup {
    id: string;
    segments: readonly InsightSegment[];
    status: ActionStatus;
    /** Total recorded segment activity, including overlap; not elapsed time. Null when none is known. */
    durationMs: number | null;
}
export interface InsightGroupEntry {
    kind: "group";
    /** Same as `group.id`. */
    id: string;
    group: InsightGroup;
}
export interface InsightThreadEntry {
    kind: "thread";
    /** The dispatch key, `thread.key`. */
    id: string;
    thread: TranscriptThread;
    /** Key of the wave block the dispatch belongs to; rows of one wave share a guide line. */
    waveKey: string;
    /** Dispatches of this thread name within the loaded transcript window. */
    episodes: number;
}
export type DelegatedRowKey = `child:${string}` | `orchestrator:${string}`;
export interface InsightSessionEntry {
    kind: "session";
    id: string;
    action: SpawnActionKind;
    /** Delegated row of the launched session; null until the launch names it. */
    rowKey: DelegatedRowKey | null;
    /** The launch's description, else the type label. */
    title: string;
    status: ActionStatus;
    presentation: ToolPresentation;
}
export type InsightEntry = InsightGroupEntry | InsightThreadEntry | InsightSessionEntry;
/** Transcript blocks that sit between Insights entries and close the open group. */
export type ModelTurnBlock = Extract<TranscriptBlock, {
    kind: "text" | "wave";
}>;
export interface ModelTurnBlockItem {
    kind: "block";
    block: ModelTurnBlock;
}
/** One model turn in transcript order. */
export type ModelTurnItem = InsightGroupEntry | InsightSessionEntry | ModelTurnBlockItem;
export interface InsightTurnSection {
    /**
     * The user turn's key; `insights-leading` before the first loaded prompt and
     * `STREAMING_TURN_KEY` for a stream whose prompt has not landed yet.
     */
    key: string;
    /** Position among the loaded user turns from 1; null for a section without a user turn. */
    ordinal: number | null;
    /** The prompt on a single line; the UI truncates it. */
    promptPreview: string;
    createdAt: string | null;
    /** Chronological. */
    entries: readonly InsightEntry[];
}
export type InsightsTopology = "orchestrator" | "direct";
export type InsightsFilter = "all" | "tools" | "threads" | "sessions" | "worksets";
export interface InsightsFilterOption {
    value: InsightsFilter;
    label: string;
}
export interface InsightsEmptyCopy {
    title: string;
    body: string;
}
/** What one ActionListButton shows in its current state. */
export interface InsightRow {
    /** Null for a group of two or more segments, the ToolsSegment row. */
    action: ActionKind | null;
    label: string;
    /** Rendered uppercase; null when the row shows none. */
    meta: string | null;
    status: ActionStatus;
}
