import { segmentAction } from "@/app/features/insights/model/actionKinds";
import { segmentDurationMs } from "@/app/features/insights/model/durations";
import { segmentStatus } from "@/app/features/insights/model/status";
import type {
  ActionKind,
  ActionStatus,
  InsightSegment,
  InsightSessionEntry,
  ModelTurnBlock,
  ModelTurnItem,
} from "@/app/features/insights/model/types";

/**
 * One line of the work a turn did on its way to the answer: a step from one of
 * its groups, or prose the model wrote between two of them.
 */
export type WorkStep =
  | { kind: "segment"; key: string; groupId: string; segment: InsightSegment }
  | { kind: "note"; key: string; text: string };

/** What a turn did before its answer, folded behind one line. */
export interface WorkFold {
  kind: "fold";
  key: string;
  /** Ids of the Insights groups folded in, oldest first. */
  groupIds: string[];
  steps: WorkStep[];
}

/** A turn as the transcript lays it out: the fold where its work began, then everything else. */
export type TurnLayoutItem =
  | WorkFold
  | InsightSessionEntry
  | { kind: "session-group"; key: string; entries: InsightSessionEntry[] }
  | { kind: "block"; key: string; block: ModelTurnBlock };

function blockOf(item: ModelTurnItem): ModelTurnBlock | null {
  if (item.kind === "group" || item.kind === "session") return null;
  // A stand-in partition may hand over any non-group item carrying a block.
  return "block" in item ? item.block : null;
}

/**
 * Lays a partitioned model turn out as the transcript shows it. Reasoning and
 * tool groups fold at the place the first of them appeared, and
 * so does prose the model wrote between them ("Let me look at the tests").
 * Launched sessions, thread waves and the prose after the last group stay in
 * the open, in their order: they are what the turn has to say.
 */
export function layoutModelTurn(items: readonly ModelTurnItem[]): TurnLayoutItem[] {
  // A later group across a session or wave must not pull prose into an
  // otherwise empty fold before that boundary.
  const followingGroup: boolean[] = [];
  let groupAhead = false;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "session" || blockOf(item)?.kind === "wave") groupAhead = false;
    followingGroup[index] = groupAhead;
    if (item.kind === "group") groupAhead = true;
  }
  const layout: TurnLayoutItem[] = [];
  let fold: WorkFold | null = null;
  const openFold = (key: string): WorkFold => {
    if (!fold) {
      fold = { kind: "fold", key: `fold:${key}`, groupIds: [], steps: [] };
      layout.push(fold);
    }
    return fold;
  };
  items.forEach((item, index) => {
    if (item.kind === "group") {
      // Group IDs include the prompt anchor, which can change as a streamed
      // child prompt reaches its snapshot. Step keys are stable within the
      // turn and keep the reader's fold choice across that transition.
      const target = openFold(item.group.segments[0]?.key ?? item.id);
      target.groupIds.push(item.id);
      for (const segment of item.group.segments) {
        target.steps.push({
          kind: "segment",
          key: segment.key,
          groupId: item.id,
          segment,
        });
      }
      return;
    }
    if (item.kind === "session") {
      // Only adjacent calls with the same resolved identity may share a
      // control. Intervening prose or work remains in its original position.
      const previous = items[index - 1];
      const last = layout.at(-1);
      if (
        item.rowKey &&
        previous?.kind === "session" &&
        previous.rowKey === item.rowKey &&
        previous.action === item.action
      ) {
        if (last?.kind === "session-group") {
          last.entries.push(item);
          return;
        }
        if (last?.kind === "session") {
          layout[layout.length - 1] = {
            kind: "session-group",
            key: last.id,
            entries: [last, item],
          };
          return;
        }
      }
      layout.push(item);
      fold = null;
      return;
    }
    const block = blockOf(item);
    if (!block) return;
    if (block.kind === "text" && followingGroup[index] && block.text.trim()) {
      openFold(block.key).steps.push({
        kind: "note",
        key: block.key,
        text: block.text,
      });
      return;
    }
    layout.push({ kind: "block", key: block.key, block });
    if (block.kind === "wave") fold = null;
  });
  return layout;
}

export function foldSegments(fold: WorkFold): InsightSegment[] {
  return fold.steps.flatMap((step) => (step.kind === "segment" ? [step.segment] : []));
}

/** A step that must stay on screen whatever the fold or the density says. */
export function isPinnedStatus(status: ActionStatus): boolean {
  return status === "failed" || status === "pending";
}

export function stepStatus(step: WorkStep): ActionStatus {
  return step.kind === "segment" ? segmentStatus(step.segment) : "ready";
}

/** Intent a tool call serves, which is how the summary line counts it. */
type Phrase =
  | "read"
  | "search"
  | "web-search"
  | "fetch"
  | "edit"
  | "command"
  | "spawn"
  | "delegate"
  | "orchestrator"
  | "thread"
  | "check"
  | "workset"
  | "goal"
  | "tool";

const PHRASE_OF: Partial<Record<ActionKind, Phrase>> = {
  "read-file": "read",
  glob: "search",
  grep: "search",
  "web-search": "web-search",
  "web-fetch": "fetch",
  "write-file": "edit",
  "edit-file": "edit",
  "run-command": "command",
  "write-command": "command",
  "spawn-agent": "spawn",
  "spawn-orchestrator": "orchestrator",
  thread: "thread",
  "session-status": "check",
  "session-read": "check",
  "session-wait": "check",
  "session-steer": "check",
  "session-cancel": "check",
  "define-workset": "workset",
  "delete-thread": "thread",
  "create-goal": "goal",
  "get-goal": "goal",
  "update-goal": "goal",
  other: "tool",
};

const ORDER: readonly Phrase[] = [
  "read",
  "search",
  "web-search",
  "fetch",
  "edit",
  "command",
  "spawn",
  "delegate",
  "orchestrator",
  "thread",
  "check",
  "workset",
  "goal",
  "tool",
];

function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function times(count: number): string {
  return count === 1 ? "" : count === 2 ? " twice" : ` ${count} times`;
}

const PHRASES: Record<Phrase, (count: number) => string> = {
  read: (n) => `read ${plural(n, "file")}`,
  search: (n) => `searched the code${times(n)}`,
  "web-search": (n) => `searched the web${times(n)}`,
  fetch: (n) => `fetched ${plural(n, "page")}`,
  edit: (n) => `edited ${plural(n, "file")}`,
  command: (n) => `ran ${plural(n, "command")}`,
  spawn: (n) => `started ${plural(n, "subagent")}`,
  delegate: (n) => `made ${plural(n, "subagent request")}`,
  orchestrator: (n) => `requested ${plural(n, "orchestrator")}`,
  thread: (n) => `ran ${plural(n, "thread")}`,
  check: (n) => `checked on subagents${times(n)}`,
  workset: (n) => `defined ${plural(n, "workset")}`,
  goal: () => "updated the goal",
  tool: (n) => `used ${plural(n, "tool")}`,
};

/** Files are counted once however often they were read or edited. */
function countKey(segment: InsightSegment, phrase: Phrase): string {
  if ((phrase === "read" || phrase === "edit") && segment.kind === "tool") {
    return segment.presentation?.summary ?? segment.key;
  }
  return segment.key;
}

/**
 * The fold's sentence: "Read 4 files, ran 2 commands". At most four intents
 * are named; any beyond them are only counted.
 */
export function workSentence(segments: readonly InsightSegment[]): string {
  const seen = new Map<Phrase, Set<string>>();
  for (const segment of segments) {
    if (segment.kind === "reasoning") continue;
    const action = segmentAction(segment);
    const phrase =
      action === "spawn-agent" &&
      (segment.kind !== "tool" ||
        segment.presentation?.delegationOutcome !== "background_started" ||
        segment.presentation.status !== "success")
        ? "delegate"
        : (PHRASE_OF[action] ?? "tool");
    const keys = seen.get(phrase) ?? new Set<string>();
    keys.add(countKey(segment, phrase));
    seen.set(phrase, keys);
  }
  const parts = ORDER.filter((phrase) => seen.has(phrase)).map((phrase) =>
    PHRASES[phrase](seen.get(phrase)?.size ?? 0),
  );
  if (!parts.length) return "";
  const shown = parts.slice(0, 4);
  const sentence = parts.length > 4 ? `${shown.join(", ")} and more` : shown.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Compact wall-clock duration: "<1s", "4.2s", "12s", "1m 12s", "1h 4m". */
export function formatWorkDuration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const seconds = ms / 1000;
  if (seconds < 1) return "<1s";
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${totalSeconds % 60}s`;
}

/** Running clock: "0:07", "12:40", "1:02:03". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

function reasoningMs(segments: readonly InsightSegment[]): number | null {
  let total: number | null = null;
  for (const segment of segments) {
    if (segment.kind !== "reasoning") continue;
    const duration = segmentDurationMs(segment);
    if (duration !== null) total = (total ?? 0) + duration;
  }
  return total;
}

/**
 * The fold's line once the turn has settled: "Worked for 1m 12s · Read 4
 * files, ran 2 commands". A turn that only reasoned "Thought for 8s".
 */
export function settledFoldLabel(
  segments: readonly InsightSegment[],
  turnDurationMs: number | null,
): string {
  const sentence = workSentence(segments);
  if (!sentence) {
    const thought = formatWorkDuration(turnDurationMs ?? reasoningMs(segments));
    return thought ? `Thought for ${thought}` : "Thought";
  }
  const worked = formatWorkDuration(turnDurationMs);
  return worked ? `Worked for ${worked} · ${sentence}` : sentence;
}

/** The fold's line while the turn is still producing output. */
export function liveFoldLabel(segments: readonly InsightSegment[]): string {
  const sentence = workSentence(segments);
  return sentence ? `Working · ${sentence}` : "Thinking";
}
