// Turns the flat orchestrator message log into the blocks the chat renders.
//
// Everything the model does between two user prompts belongs to one model
// message: reasoning, prose, the worksets it defined and the waves of threads
// it dispatched. Thread tool calls from one assistant message form one package;
// in-batch `threads` deps split that package into stacked DAG rows.

import { displayPromptFromMessageText } from "@/app/lib/format";
import { stripNativeToolMarkup } from "@/app/lib/toolMarkup";
import {
  mergeThreadLog,
  persistedThreadLog,
  type ThreadLogLine,
} from "@/app/lib/threadLog";
import type { RuntimeThread } from "@/app/store/runtimeStore";
import type {
  AgentEvent,
  SessionSnapshotResponse,
  ToolCall,
} from "@/app/types/api";

/** Exact assistant marker written after any partial response on cancellation. */
export const RUN_CANCELLED_MARKER = "[run cancelled by user]";
/**
 * Prefix the backend puts on every tool result that exists only because the
 * user stopped the run — both the synthetic result that closes a call the run
 * never reached and the one a worker returns when its dispatch is drained.
 */
const TOOL_CALL_CANCELLED_MARKER = "[tool call cancelled by user]";

/**
 * Orchestrator tools that only read back state the side panel already shows.
 * A badge for them is noise, so the transcript keeps the steps that changed
 * something — dispatches, worksets, deletions — and drops the lookups.
 */
const SILENT_TOOLS = new Set([
  "threads",
  "thread_read",
  "workset_read",
  "workset_list",
]);

export type ThreadState =
  | "running"
  | "pending"
  | "done"
  | "cancelled"
  | "error";

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
  /** One assistant dispatch batch, split into topological DAG rows. */
  | { kind: "wave"; key: string; rows: TranscriptThread[][] };

export interface UserTurn {
  kind: "user";
  key: string;
  text: string;
  /** Raw snapshot index, which is what a revert addresses the turn by. */
  messageIndex: number;
  /** When the message entered the transcript log, if the backend knows. */
  createdAt: string | null;
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

export type TranscriptTurn = UserTurn | ModelTurn;

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
}

function parseArguments(call: ToolCall): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(call.function?.arguments || "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

interface BuildContext {
  liveThreads: Record<string, RuntimeThread>;
  /** Each thread's persisted events, split into the episodes that produced them. */
  threadEpisodes: Record<string, AgentEvent[][]>;
  /** How often each name is dispatched across the whole transcript. */
  dispatchCounts: Record<string, number>;
}

/**
 * One thread's persisted events cut into episodes, oldest first.
 *
 * The backend writes them as one stream per name, so a re-dispatched thread
 * arrives as several runs end to end, each opened by its `thread_started`.
 */
function splitEpisodes(events: AgentEvent[]): AgentEvent[][] {
  const episodes: AgentEvent[][] = [];
  events.forEach((event) => {
    if (event.type === "thread_started" || !episodes.length) episodes.push([]);
    episodes[episodes.length - 1].push(event);
  });
  return episodes;
}

function threadEpisodes(
  events: Record<string, AgentEvent[]>,
): Record<string, AgentEvent[][]> {
  const episodes: Record<string, AgentEvent[][]> = {};
  Object.entries(events).forEach(([name, list]) => {
    episodes[name] = splitEpisodes(list);
  });
  return episodes;
}

function countThreadDispatches(
  messages: SessionSnapshotResponse["messages"],
): Record<string, number> {
  const counts: Record<string, number> = {};
  messages.forEach((message) => {
    if (message.role !== "assistant") return;
    (message.tool_calls ?? []).forEach((call) => {
      if (call.function?.name !== "thread") return;
      const name = threadName(call);
      counts[name] = (counts[name] ?? 0) + 1;
    });
  });
  return counts;
}

function threadName(call: ToolCall): string {
  return text(parseArguments(call).name) || "thread";
}

/** Public for the threads list, which ranks rows by the open DAG batch. */
export function dispatchThreadName(call: ToolCall): string {
  return threadName(call);
}

/** Source thread names from a dispatch; only strings count. */
function sourceThreads(call: ToolCall): string[] {
  const value = parseArguments(call).threads;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Split one assistant batch into Kahn levels using in-batch `threads` deps.
 * Cycles / duplicate names fall back to a single row so the UI still renders.
 */
export function partitionThreadCalls(calls: ToolCall[]): ToolCall[][] {
  const n = calls.length;
  if (n <= 1) return n ? [calls] : [];

  const nameToIndex = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    const name = threadName(calls[i]);
    if (nameToIndex.has(name)) return [calls];
    nameToIndex.set(name, i);
  }

  const adjacency: number[][] = Array.from({ length: n }, () => []);
  const inDegree = Array.from({ length: n }, () => 0);

  for (let i = 0; i < n; i += 1) {
    const seen = new Set<number>();
    for (const source of sourceThreads(calls[i])) {
      const depIdx = nameToIndex.get(source);
      if (depIdx === undefined) continue;
      if (depIdx === i) return [calls];
      if (seen.has(depIdx)) continue;
      seen.add(depIdx);
      adjacency[depIdx].push(i);
      inDegree[i] += 1;
    }
  }

  const waves: ToolCall[][] = [];
  const sorted = Array.from({ length: n }, () => false);
  let sortedCount = 0;
  const degree = inDegree.slice();

  while (sortedCount < n) {
    const waveIdxs: number[] = [];
    for (let i = 0; i < n; i += 1) {
      if (!sorted[i] && degree[i] === 0) waveIdxs.push(i);
    }
    if (!waveIdxs.length) return [calls];
    for (const node of waveIdxs) {
      for (const neighbor of adjacency[node]) degree[neighbor] -= 1;
      sorted[node] = true;
    }
    sortedCount += waveIdxs.length;
    waves.push(waveIdxs.map((i) => calls[i]));
  }

  return waves;
}

/**
 * The events of one dispatch.
 *
 * The snapshot carries only a bounded window of each thread's events while the
 * transcript keeps every dispatch, so the episodes are lined up with the newest
 * dispatch; the oldest cards fall off the front and show their action instead.
 */
function eventsForEpisode(
  ctx: BuildContext,
  name: string,
  episode: number,
): AgentEvent[] | undefined {
  const episodes = ctx.threadEpisodes[name] ?? [];
  const dropped = (ctx.dispatchCounts[name] ?? episodes.length) - episodes.length;
  return episodes[episode - dropped];
}

/**
 * Tool results that belong to one assistant message: the run of `tool` rows
 * that follow it, stopping at the next user/assistant turn.
 *
 * Scoped per turn so a reused `tool_call_id` (historically `recovered_1` from
 * reasoning salvage) cannot steal an earlier episode onto a later thread card.
 */
function toolResultsForAssistant(
  messages: SessionSnapshotResponse["messages"],
  assistantIndex: number,
): Map<string, string> {
  const results = new Map<string, string>();
  for (let index = assistantIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "tool") {
      results.set(message.tool_call_id, message.content);
      continue;
    }
    if (message.role === "assistant" || message.role === "user") break;
  }
  return results;
}

/**
 * @param episode Which dispatch of this name the card stands for, from 0.
 * @param batchNames Thread names in this assistant message (for in-batch deps).
 * @param finishedNames Names in this batch that have finished (tool result or
 *   live `thread_finished`). Tool results for a DAG batch are committed only
 *   after every wave returns, so live finish is what flips cards to done while
 *   later rows are still pending.
 */
function describeThread(
  call: ToolCall,
  episode: number,
  identity: string,
  ctx: BuildContext,
  results: Map<string, string>,
  batchNames: Set<string>,
  finishedNames: Set<string>,
): TranscriptThread {
  const name = threadName(call);
  const action = text(parseArguments(call).action);
  const result = results.get(call.id) ?? null;
  // The stream is keyed by name and only ever describes the dispatch running
  // now, which is the newest one. Handing it to the earlier cards of that name
  // would replay this episode's commands on them and mark them failed with it.
  const live =
    episode === (ctx.dispatchCounts[name] ?? 1) - 1
      ? ctx.liveThreads[name]
      : undefined;

  const waitingOnBatchDep = sourceThreads(call).some(
    (source) => batchNames.has(source) && !finishedNames.has(source),
  );

  const episodeEvents = eventsForEpisode(ctx, name, episode);
  const finishedPersisted = episodeEvents?.some(
    (event) => event.type === "thread_finished",
  );
  const finishedLive = live?.status === "finished";
  const cancelled =
    result?.startsWith(TOOL_CALL_CANCELLED_MARKER) === true ||
    Boolean(live?.cancelled);
  const state: ThreadState = cancelled
    ? "cancelled"
    : live?.isError
      ? "error"
      : result != null || finishedLive || finishedPersisted
        ? "done"
        : waitingOnBatchDep
          ? "pending"
          : "running";

  return {
    key: identity,
    name,
    action,
    summary: result || action,
    // The persisted events are what a reload falls back on, and the stream is
    // what carries the commands issued since the last snapshot.
    log: mergeThreadLog(
      persistedThreadLog(episodeEvents),
      live?.log ?? [],
    ),
    state,
  };
}

/**
 * Newest block of a kind, which is the only one streamed output could belong to.
 */
function lastBlockText(
  blocks: TranscriptBlock[],
  kind: "text" | "thoughts",
): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (
      block.kind === kind &&
      !(
        kind === "text" &&
        block.kind === "text" &&
        block.text.trim() === RUN_CANCELLED_MARKER
      )
    ) {
      return block.text;
    }
  }
  return null;
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
function nextOrdinal(
  blocks: TranscriptBlock[],
  kind: TranscriptBlock["kind"],
): number {
  return blocks.reduce(
    (total, block) => (block.kind === kind ? total + 1 : total),
    0,
  );
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
): TranscriptTurn[] {
  const reasoning = stripNativeToolMarkup(stream.reasoning).trim();
  const text = stripNativeToolMarkup(stream.text).trim();
  if (!reasoning && !text) return turns;

  const last = turns[turns.length - 1];
  const live = last?.kind === "model" && !promptUncommitted;
  // The run answers with output before its first message is persisted, so the
  // turn it belongs to may not exist yet. Its key stays out of the namespace a
  // committed turn draws from — the index of its message — because a key that
  // lands on one of those indexes hands this turn the other one's identity: the
  // same React row, and whatever that turn is addressed by elsewhere, down to
  // the snapshot its finished run captured.
  const turn: ModelTurn = live
    ? { ...last, blocks: last.blocks.slice() }
    : {
        kind: "model",
        key: STREAMING_TURN_KEY,
        blocks: [],
        durationMs: null,
        messageIndex: null,
      };

  let appended = false;
  if (reasoning && !lastBlockText(turn.blocks, "thoughts")?.includes(reasoning)) {
    turn.blocks.push({
      kind: "thoughts",
      key: `thoughts-${nextOrdinal(turn.blocks, "thoughts")}`,
      text: reasoning,
      durationMs: null,
      // Prose arriving means the model has stopped thinking and started
      // answering, even though this reasoning is not committed yet.
      streaming: !text,
    });
    appended = true;
  }
  if (text && !lastBlockText(turn.blocks, "text")?.includes(text)) {
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

/**
 * Group the snapshot messages into user bubbles and model messages. Live thread
 * state comes from the SSE store so a wave animates before the snapshot lands.
 */
export function buildTranscript(
  snapshot: SessionSnapshotResponse | null,
  liveThreads: Record<string, RuntimeThread>,
): TranscriptTurn[] {
  const messages = snapshot?.messages ?? [];
  const durations = snapshot?.response_timing.response_durations_ms ?? [];
  const createdAt = snapshot?.message_created_at ?? [];
  const windowStart = snapshot?.message_page?.start ?? 0;

  const windowDispatchCounts = countThreadDispatches(messages);
  const persistedDispatchCounts = new Map(
    (snapshot?.threads ?? []).map((thread) => [
      thread.name,
      thread.episode_count,
    ]),
  );
  const activeNames = new Set(snapshot?.active_threads ?? []);
  const dispatchCounts: Record<string, number> = {};
  const dispatchesSeen: Record<string, number> = {};
  for (const [name, visibleCount] of Object.entries(windowDispatchCounts)) {
    const persistedCount = persistedDispatchCounts.get(name) ?? 0;
    const totalCount = Math.max(
      visibleCount,
      persistedCount + (activeNames.has(name) ? 1 : 0),
    );
    dispatchCounts[name] = totalCount;
    dispatchesSeen[name] = Math.max(0, totalCount - visibleCount);
  }
  const ctx: BuildContext = {
    liveThreads,
    threadEpisodes: threadEpisodes(snapshot?.thread_events ?? {}),
    dispatchCounts,
  };

  const turns: TranscriptTurn[] = [];
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
      turns.push({
        kind: "user",
        key: `user-${absoluteIndex}`,
        text: displayPromptFromMessageText(message.content),
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

    const content = stripNativeToolMarkup(message.content ?? "").trim();
    if (content) {
      blocks.push({
        kind: "text",
        key: `text-${nextOrdinal(blocks, "text")}`,
        text: content,
      });
    }

    const results = toolResultsForAssistant(messages, index);
    const threadCalls: ToolCall[] = [];
    (message.tool_calls ?? []).forEach((call, callIndex) => {
      const name = call.function?.name ?? "tool";
      const key = `${name}-${absoluteIndex}-${callIndex}`;
      if (name === "thread") {
        threadCalls.push(call);
      } else if (name === "workset_define") {
        blocks.push({
          kind: "workset",
          key,
          worksetId: text(parseArguments(call).id),
          pending: !results.has(call.id),
        });
      } else if (!SILENT_TOOLS.has(name)) {
        blocks.push({ kind: "tool", key, name, pending: !results.has(call.id) });
      }
    });

    if (threadCalls.length) {
      const batchNames = new Set(threadCalls.map(threadName));
      // Prefer live `thread_finished` over tool results: DAG tool rows are
      // committed only once every topological wave has returned.
      const finishedNames = new Set<string>();
      for (const call of threadCalls) {
        const name = threadName(call);
        if (results.has(call.id)) {
          finishedNames.add(name);
          continue;
        }
        if (ctx.liveThreads[name]?.status === "finished") {
          finishedNames.add(name);
          continue;
        }
        // Snapshot may already have thread_finished before the tool-result
        // batch is committed for this DAG.
        const episodes = ctx.threadEpisodes[name] ?? [];
        const latest = episodes[episodes.length - 1];
        if (latest?.some((event) => event.type === "thread_finished")) {
          finishedNames.add(name);
        }
      }
      const rows = partitionThreadCalls(threadCalls).map((level) =>
        level.map((call) => {
          const dispatched = threadName(call);
          const episode = dispatchesSeen[dispatched] ?? 0;
          dispatchesSeen[dispatched] = episode + 1;
          return describeThread(
            call,
            episode,
            `${dispatched}@${absoluteIndex}:${call.id}`,
            ctx,
            results,
            batchNames,
            finishedNames,
          );
        }),
      );
      blocks.push({ kind: "wave", key: `wave-${absoluteIndex}`, rows });
    }
  });

  let durationIndex = durations.length - 1;
  let skipActiveTurn =
    Boolean(snapshot?.active_run) && turns[turns.length - 1]?.kind === "model";
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
