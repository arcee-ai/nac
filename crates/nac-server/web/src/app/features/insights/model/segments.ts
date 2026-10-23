import { actionKindForTool, isSpawnAction } from "@/app/features/insights/model/actionKinds";
import { sumSegmentDurations } from "@/app/features/insights/model/durations";
import { actionTypeLabel } from "@/app/features/insights/model/labels";
import {
  combineStatuses,
  segmentStatus,
  toolActionStatus,
} from "@/app/features/insights/model/status";
import type {
  DelegatedRowKey,
  InsightGroup,
  InsightGroupEntry,
  InsightSegment,
  InsightSessionEntry,
  ModelTurnItem,
  SpawnActionKind,
} from "@/app/features/insights/model/types";
import type { ToolPresentation, ToolPresentationStatus } from "@/app/lib/toolPresentation";
import {
  STREAMING_TURN_KEY,
  type ModelTurn,
  type TranscriptBlock,
  type TranscriptTurn,
} from "@/app/lib/transcript";

/** Anchor of a model turn that comes before every turn of the loaded window. */
export const LEADING_ANCHOR = "insights-leading";

const UNSETTLED: ReadonlySet<ToolPresentationStatus> = new Set([
  "pending",
  "running",
  "awaiting-approval",
]);

const ROW_PREFIXES: Record<SpawnActionKind, "child" | "orchestrator"> = {
  "spawn-agent": "child",
  "spawn-orchestrator": "orchestrator",
};

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
export function insightAnchor(turn: ModelTurn, previous: TranscriptTurn | undefined): string {
  if (previous && previous.kind !== "model") return previous.key;
  return turn.key === STREAMING_TURN_KEY ? STREAMING_TURN_KEY : LEADING_ANCHOR;
}

export function createInsightGroup(id: string, segments: readonly InsightSegment[]): InsightGroup {
  return {
    id,
    segments,
    status: combineStatuses(segments.map(segmentStatus)),
    durationMs: sumSegmentDurations(segments),
  };
}

function toSegment(block: TranscriptBlock): InsightSegment | null {
  switch (block.kind) {
    case "thoughts":
      if (!block.text.trim()) return null;
      return {
        kind: "reasoning",
        key: block.key,
        text: block.text,
        durationMs: block.durationMs,
        streaming: block.streaming,
      };
    case "workset":
      return {
        kind: "workset",
        key: block.key,
        worksetId: block.worksetId,
        pending: block.pending,
      };
    case "tool":
      return {
        kind: "tool",
        key: block.key,
        name: block.name,
        action: actionKindForTool(block.name),
        presentation: null,
        pending: block.pending,
      };
    case "tool-detail":
      return {
        kind: "tool",
        key: block.key,
        name: block.presentation.name,
        action: actionKindForTool(block.presentation.name),
        presentation: block.presentation,
        pending: UNSETTLED.has(block.presentation.status),
      };
    default:
      return null;
  }
}

function sessionEntry(
  id: string,
  action: SpawnActionKind,
  presentation: ToolPresentation,
): InsightSessionEntry {
  const sessionId = presentation.spawnedSessionId;
  const rowKey: DelegatedRowKey | null = sessionId ? `${ROW_PREFIXES[action]}:${sessionId}` : null;
  return {
    kind: "session",
    id,
    action,
    rowKey,
    title: presentation.summary ?? actionTypeLabel(action),
    status: toolActionStatus(presentation.status),
    presentation,
  };
}

function partition(blocks: readonly TranscriptBlock[], anchor: string): ModelTurnItem[] {
  const items: ModelTurnItem[] = [];
  let open: InsightSegment[] = [];
  const close = () => {
    if (!open.length) return;
    const id = `${anchor}:${open[0].key}`;
    const entry: InsightGroupEntry = { kind: "group", id, group: createInsightGroup(id, open) };
    items.push(entry);
    open = [];
  };
  for (const block of blocks) {
    if (block.kind === "text" || block.kind === "wave") {
      close();
      items.push({ kind: "block", block });
      continue;
    }
    if (block.kind === "tool-detail") {
      const action = actionKindForTool(block.presentation.name);
      if (isSpawnAction(action)) {
        close();
        items.push(sessionEntry(`${anchor}:${block.key}`, action, block.presentation));
        continue;
      }
    }
    const segment = toSegment(block);
    if (segment) open.push(segment);
  }
  close();
  return items;
}

const partitions = new WeakMap<ModelTurn, { anchor: string; items: readonly ModelTurnItem[] }>();

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
export function partitionModelTurn(
  turn: ModelTurn,
  previous: TranscriptTurn | undefined,
): readonly ModelTurnItem[] {
  const anchor = insightAnchor(turn, previous);
  const cached = partitions.get(turn);
  if (cached?.anchor === anchor) return cached.items;
  const items = partition(turn.blocks, anchor);
  partitions.set(turn, { anchor, items });
  return items;
}
