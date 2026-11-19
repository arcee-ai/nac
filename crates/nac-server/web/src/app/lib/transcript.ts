// Turns the session's message log into the blocks the chat renders.

import { displayPromptFromMessageText, invokedSkillNames } from "@/app/lib/format";
import {
  parseDelegatedCompletion,
  type DelegatedCompletion,
} from "@/app/features/delegation/completion";
import { parseGoalContinuation } from "@/app/features/goals/continuation";
import { stripNativeToolMarkup } from "@/app/lib/toolMarkup";
import {
  ambiguousToolResultIds,
  assistantTurnCancelled,
  collectToolResults,
  indexToolEvents,
  presentToolCall,
  type ToolPresentation,
} from "@/app/lib/toolPresentation";
import type { ThreadLogLine } from "@/app/lib/threadLog";
import type { AgentEvent, DispatchWeight, SessionSnapshotResponse } from "@/app/types/api";

/** Exact assistant marker written after any partial response on cancellation. */
export const RUN_CANCELLED_MARKER = "[run cancelled by user]";
/** Stored sentinel identifying an assistant response abandoned by run failure. */
export const RUN_FAILED_PARTIAL_MARKER = "[run failed after this partial assistant response]";

function stripRunFailureMarker(content: string): string {
  const trimmed = content.trim();
  if (trimmed === RUN_FAILED_PARTIAL_MARKER) return "";
  const suffix = `\n\n${RUN_FAILED_PARTIAL_MARKER}`;
  return trimmed.endsWith(suffix) ? trimmed.slice(0, -suffix.length).trimEnd() : trimmed;
}
export type ThreadState = "running" | "pending" | "done" | "cancelled" | "error";

export interface TranscriptThread {
  /**
   * Identifies the dispatch behind the card rather than the thread behind it.
   * One name can be dispatched again — each dispatch is an episode of its own,
   * with its own log and its own result — so keying by name would tie every
   * card of that name together.
   */
  key: string;
  name: string;
  /** What the orchestrator asked the thread to do. */
  action: string;
  /** Weight class the dispatch was classified into, if any. */
  weight: DispatchWeight | null;
  /** What the thread reported once it was done, or its action before then. */
  summary: string;
  /** Commands the thread has issued, oldest first, for the tail on its card. */
  log: ThreadLogLine[];
  state: ThreadState;
}

export type TranscriptBlock =
  | {
      kind: "thoughts";
      key: string;
      text: string;
      durationMs: number | null;
      /** The model is producing this reasoning right now. */
      streaming: boolean;
    }
  | { kind: "text"; key: string; text: string }
  | { kind: "workset"; key: string; worksetId: string; pending: boolean }
  | { kind: "tool"; key: string; name: string; pending: boolean }
  | { kind: "tool-detail"; key: string; presentation: ToolPresentation }
  /** One assistant dispatch batch, split into topological DAG rows. */
  | { kind: "wave"; key: string; rows: TranscriptThread[][] };

export interface UserTurn {
  kind: "user";
  key: string;
  text: string;
  /**
   * Skills expanded into this prompt, parsed from the stored message — null
   * for an ordinary prompt. Shown as the bubble's expansion indicator.
   */
  invokedSkills: string[] | null;
  /** Raw snapshot index, which is what a revert addresses the turn by. */
  messageIndex: number;
  /** When the message entered the transcript log, if the backend knows. */
  createdAt: string | null;
  /** Submitted but not in the snapshot yet, so its index is only expected. */
  pending?: true;
}

export interface ModelTurn {
  kind: "model";
  key: string;
  blocks: TranscriptBlock[];
  /** How long the run behind this turn took, once it finished. */
  durationMs: number | null;
  /**
   * Raw snapshot index of the turn's first message, which is what places it
   * against the transcript lengths the workspace revisions were captured at.
   * Null while the turn is only a stream and has nothing persisted yet.
   */
  messageIndex: number | null;
}

export interface DelegatedCompletionTurn {
  kind: "delegated-completion";
  key: string;
  completion: DelegatedCompletion;
  messageIndex: number;
  createdAt: string | null;
}

/**
 * A run NAC admitted for a durable goal. Its stored message is the control
 * prompt the model reads; the transcript shows only the goal and objective.
 */
export interface GoalContinuationTurn {
  kind: "goal-continuation";
  key: string;
  goalId: string;
  objective: string;
  /**
   * The goal's first run in a fully loaded transcript. Unknown, and so false,
   * while older messages are still unloaded.
   */
  first: boolean;
  messageIndex: number;
  createdAt: string | null;
}

export type TranscriptTurn = UserTurn | ModelTurn | DelegatedCompletionTurn | GoalContinuationTurn;

/**
 * Key of a model turn that exists only as a stream, with nothing persisted to
 * key it by. Committed turns are keyed by their message index, so this one is
 * named rather than numbered to keep the two apart.
 */
export const STREAMING_TURN_KEY = "model-streaming";

/** Model output that has arrived over the stream, prose and reasoning apart. */
export interface StreamedOutput {
  text: string;
  reasoning: string;
  /**
   * No more of it is coming, as its call was committed or its run ended, so
   * once the snapshot holds its answer it holds all of it.
   */
  settled?: boolean;
}

/**
 * Whether the newest block of a kind, the only one streamed output could belong
 * to, already holds it. Whitespace is ignored: a stored reasoning joins its
 * summary parts with blank lines that the stream never carried.
 */
function holdsStreamed(blocks: TranscriptBlock[], kind: "text" | "thoughts", streamed: string) {
  const squash = (value: string) => value.replace(/\s+/g, "");
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (
      block.kind === kind &&
      !(kind === "text" && block.kind === "text" && block.text.trim() === RUN_CANCELLED_MARKER)
    ) {
      return squash(block.text).includes(squash(streamed));
    }
  }
  return false;
}

/**
 * Position of the next block of a kind within its turn.
 *
 * Blocks are keyed by this rather than by the message they came out of, so the
 * block a run is streaming and the block the snapshot commits for it end up
 * with the same key. React then updates that block in place instead of
 * replacing it, which is what lets an expanded reasoning badge stay open
 * across the commit.
 */
function nextOrdinal(blocks: TranscriptBlock[], kind: TranscriptBlock["kind"]): number {
  return blocks.reduce((total, block) => (block.kind === kind ? total + 1 : total), 0);
}

/**
 * Show model output that has reached the browser ahead of the snapshot.
 *
 * The buffers outlive the message being committed, so the text does not blink
 * out while the snapshot is refetched; what keeps it from being shown twice is
 * the check against what the snapshot already carries.
 *
 * Only the turn the output belongs to is rebuilt: earlier turns are handed back
 * by reference, and the array itself is returned unchanged when the stream adds
 * nothing. That is what lets a memoized row skip a delta that never moved it.
 */
export function withStreamedOutput(
  turns: TranscriptTurn[],
  stream: StreamedOutput,
  /**
   * The prompt this output answers has not reached the snapshot yet, so a model
   * turn at the end of `turns` is the previous run's. Appending to it would put
   * this run's output inside that turn and read as its work — its duration, and
   * the snapshot its run captured, would then describe this output too.
   */
  promptUncommitted = false,
  /**
   * Key of a turn the output has to open, since its first message is not
   * persisted yet. The default stays out of the committed namespace; a caller
   * passes a committed key only when it is the one this turn will be given.
   */
  key = STREAMING_TURN_KEY,
): TranscriptTurn[] {
  const reasoning = stripNativeToolMarkup(stream.reasoning).trim();
  const text = stripNativeToolMarkup(stream.text).trim();
  if (!reasoning && !text) return turns;

  const last = turns[turns.length - 1];
  const live = last?.kind === "model" && !promptUncommitted;
  const turn: ModelTurn = live
    ? { ...last, blocks: last.blocks.slice() }
    : { kind: "model", key, blocks: [], durationMs: null, messageIndex: null };

  // Some providers store no reasoning text, so settled reasoning would
  // otherwise trail the answer that the snapshot already shows.
  const landed = stream.settled === true && text !== "" && holdsStreamed(turn.blocks, "text", text);
  let appended = false;
  if (reasoning && !landed && !holdsStreamed(turn.blocks, "thoughts", reasoning)) {
    turn.blocks.push({
      kind: "thoughts",
      key: `thoughts-${nextOrdinal(turn.blocks, "thoughts")}`,
      text: reasoning,
      durationMs: null,
      // Prose arriving means the model has stopped thinking and started
      // answering, even though this reasoning is not committed yet.
      streaming: !text && !stream.settled,
    });
    appended = true;
  }
  if (text && !holdsStreamed(turn.blocks, "text", text)) {
    turn.blocks.push({
      kind: "text",
      key: `text-${nextOrdinal(turn.blocks, "text")}`,
      text,
    });
    appended = true;
  }
  if (!appended) return turns;

  return live ? [...turns.slice(0, -1), turn] : [...turns, turn];
}

/** Group the snapshot messages into user bubbles and model messages. */
export function buildTranscript(
  snapshot: SessionSnapshotResponse | null,
  livePrimaryToolEvents: AgentEvent[] = [],
  pendingPermissionCallIds: ReadonlySet<string> = new Set(),
): TranscriptTurn[] {
  const messages = snapshot?.messages ?? [];
  const durations = snapshot?.response_timing.response_durations_ms ?? [];
  const createdAt = snapshot?.message_created_at ?? [];
  const windowStart = snapshot?.message_page?.start ?? 0;
  const direct =
    snapshot?.metadata?.behavior === "direct" ||
    snapshot?.metadata?.behavior === "direct-with-orchestrator";
  const toolEvents = indexToolEvents(
    direct ? [...(snapshot?.primary_tool_events ?? []), ...livePrimaryToolEvents] : [],
  );
  let lastUserIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === "user") lastUserIndex = index;
  });

  const turns: TranscriptTurn[] = [];
  const goalsSeen = new Set<string>();
  let current: ModelTurn | null = null;
  /**
   * How many entries of the duration history each model turn stands for. The
   * backend indexes that history by visible response — an assistant message
   * with no tool calls — and a turn does not always hold exactly one: a cancel
   * mid-stream commits the partial response and the marker after it, while a
   * run that died between tool rounds leaves a turn with none at all.
   */
  const responsesPerTurn = new Map<ModelTurn, number>();

  messages.forEach((message, index) => {
    const absoluteIndex = windowStart + index;
    if (message.role === "system" || message.role === "tool") return;

    if (message.role === "user") {
      current = null;
      const completion = parseDelegatedCompletion(message.content);
      if (completion) {
        turns.push({
          kind: "delegated-completion",
          key: `delegated-completion-${absoluteIndex}`,
          completion,
          messageIndex: absoluteIndex,
          createdAt: createdAt[index] ?? null,
        });
        return;
      }
      const continuation = parseGoalContinuation(message.content);
      if (continuation) {
        turns.push({
          kind: "goal-continuation",
          key: `goal-continuation-${absoluteIndex}`,
          goalId: continuation.goalId,
          objective: continuation.objective,
          first: windowStart === 0 && !goalsSeen.has(continuation.goalId),
          messageIndex: absoluteIndex,
          createdAt: createdAt[index] ?? null,
        });
        goalsSeen.add(continuation.goalId);
        return;
      }
      turns.push({
        kind: "user",
        key: `user-${absoluteIndex}`,
        text: displayPromptFromMessageText(message.content),
        invokedSkills: invokedSkillNames(message.content),
        messageIndex: absoluteIndex,
        createdAt: createdAt[index] ?? null,
      });
      return;
    }

    if (!current) {
      current = {
        kind: "model",
        key: `model-${absoluteIndex}`,
        blocks: [],
        durationMs: null,
        messageIndex: absoluteIndex,
      };
      turns.push(current);
    }
    current.key = `model-${absoluteIndex}`;
    current.messageIndex = absoluteIndex;
    const blocks = current.blocks;
    if (!message.tool_calls?.length) {
      responsesPerTurn.set(current, (responsesPerTurn.get(current) ?? 0) + 1);
    }

    const reasoning = stripNativeToolMarkup(message.reasoning_text ?? "").trim();
    if (reasoning) {
      blocks.push({
        kind: "thoughts",
        key: `thoughts-${nextOrdinal(blocks, "thoughts")}`,
        text: reasoning,
        // The model call this message came out of, which for a reasoning model
        // is very nearly the time it spent thinking.
        durationMs: message.duration_ms ?? null,
        streaming: false,
      });
    }

    // The sentinel is status metadata, not model prose. Keeping it out of the
    // text block prevents Markdown rendering and clipboard leakage.
    const content = stripRunFailureMarker(stripNativeToolMarkup(message.content ?? ""));
    if (content) {
      blocks.push({
        kind: "text",
        key: `text-${nextOrdinal(blocks, "text")}`,
        text: content,
      });
    }

    const results = collectToolResults(messages, index);
    const ambiguousResults = ambiguousToolResultIds(messages, index);
    (message.tool_calls ?? []).forEach((call, callIndex) => {
      const name = call.function?.name ?? "tool";
      const key = `${name}-${absoluteIndex}-${callIndex}`;
      const repeatedInBatch =
        (message.tool_calls ?? []).filter((item) => item.id === call.id).length > 1;
      const result = repeatedInBatch ? undefined : results.get(call.id);
      if (direct) {
        blocks.push({
          kind: "tool-detail",
          key: `tool-${absoluteIndex}-${call.id}${repeatedInBatch ? `-${callIndex}` : ""}`,
          presentation: presentToolCall({
            call,
            events: toolEvents.get(call.id),
            hasResult: result != null,
            resultText: result?.text ?? null,
            resultHasImage: result?.hasImage ?? false,
            active: Boolean(snapshot?.active_run) && index > lastUserIndex,
            awaitingApproval: pendingPermissionCallIds.has(call.id),
            turnCancelled: assistantTurnCancelled(messages, index, RUN_CANCELLED_MARKER),
            occurrence: snapshot?.tool_call_occurrences?.[index],
            ambiguousResult: repeatedInBatch || ambiguousResults.has(call.id),
            unboundEvents: name === "subagent" || name === "orchestrator_launch",
          }),
        });
      } else {
        blocks.push({ kind: "tool", key, name, pending: result == null });
      }
    });
  });

  let durationIndex = durations.length - 1;
  let skipActiveTurn = Boolean(snapshot?.active_run) && turns[turns.length - 1]?.kind === "model";
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.kind !== "model") continue;
    if (skipActiveTurn) {
      skipActiveTurn = false;
      continue;
    }
    const responses = responsesPerTurn.get(turn) ?? 0;
    if (!responses) continue;
    turn.durationMs = durations[durationIndex] ?? null;
    durationIndex -= responses;
  }

  return turns;
}
