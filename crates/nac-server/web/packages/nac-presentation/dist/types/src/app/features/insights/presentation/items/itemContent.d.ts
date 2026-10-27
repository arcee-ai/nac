import type { ReactNode } from "react";
import { InsightItemState } from "../../../../atoms";
import type { DelegatedRowKey, InsightSegment } from "../../model/types";
import type { SessionResolver } from "../useDelegatedSessions";
export type ReasoningSegment = Extract<InsightSegment, {
    kind: "reasoning";
}>;
export type ToolSegment = Extract<InsightSegment, {
    kind: "tool";
}>;
export type WorksetSegment = Extract<InsightSegment, {
    kind: "workset";
}>;
export interface ItemContext {
    resolveSession: SessionResolver;
    openSubagent: (rowKey: DelegatedRowKey) => void;
    openWorkset: (worksetId: string) => void;
}
export interface ItemContent {
    /** Default and Error title; Loading shows the live label instead. */
    title: string;
    /** Set only for a body with text worth copying. */
    copyText?: string | null;
    body?: (state: InsightItemState) => ReactNode;
}
export declare const isDefault: (state: InsightItemState) => state is InsightItemState.Default;
/** Inputs stay visible after a failure; nothing shows while the call runs. */
export declare const showsInput: (state: InsightItemState) => state is InsightItemState.Default | InsightItemState.Error;
/** Durations appear only when the backend reports one. */
export declare function withDuration(title: string, durationMs: number | null | undefined): string;
