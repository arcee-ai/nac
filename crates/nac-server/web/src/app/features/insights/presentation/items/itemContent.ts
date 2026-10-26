import type { ReactNode } from "react";

import { InsightItemState } from "@/app/atoms";
import type { DelegatedRowKey, InsightSegment } from "@/app/features/insights/model/types";
import type { SessionResolver } from "@/app/features/insights/presentation/useDelegatedSessions";
import { formatSeconds } from "@/app/lib/format";
import type { ToolCallRef } from "@/app/services/queries/toolCalls";

export type ReasoningSegment = Extract<InsightSegment, { kind: "reasoning" }>;
export type ToolSegment = Extract<InsightSegment, { kind: "tool" }>;
export type WorksetSegment = Extract<InsightSegment, { kind: "workset" }>;

export interface ItemContext {
  sessionId: string;
  resolveSession: SessionResolver;
  openSubagent: (rowKey: DelegatedRowKey) => void;
  openWorkset: (worksetId: string) => void;
  /** The session's roots an absolute tool path may start with, as chat links strip them. */
  workspaceRoots: (string | null | undefined)[];
  /** Opens a workspace-relative path in Files. */
  openFile: (path: string) => void;
}

export interface ItemContent {
  /** Default and Error title; Loading shows the live label instead. */
  title: string;
  /** Set only for a body with text worth copying. */
  copyText?: string | null;
  body?: (state: InsightItemState) => ReactNode;
}

export const isDefault = (state: InsightItemState) => state === InsightItemState.Default;

/** The call whose full content a segment can load; none for a compact tool block. */
export function segmentCall(segment: ToolSegment): ToolCallRef | null {
  const id = segment.presentation?.callId;
  return id ? { id, blockKey: segment.key } : null;
}

/** Inputs stay visible after a failure; nothing shows while the call runs. */
export const showsInput = (state: InsightItemState) => state !== InsightItemState.Loading;

/** Durations appear only when the backend reports one. */
export function withDuration(title: string, durationMs: number | null | undefined): string {
  return durationMs == null ? title : `${title}, ${formatSeconds(durationMs)}`;
}
