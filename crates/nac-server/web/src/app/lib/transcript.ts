// Turns the flat orchestrator message log into the blocks the chat renders.
//
// Everything the model does between two user prompts belongs to one model
// message: reasoning, prose, the worksets it defined and the waves of threads
// it dispatched. Tool calls issued together in a single assistant message ran
// in parallel, so each such assistant message becomes one wave.

import { displayPromptFromMessageText } from "@/app/lib/format";
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

/** Long sessions would otherwise mount thousands of markdown blocks. */
const MAX_TURNS = 40;

export type ThreadState = "running" | "done" | "error";

export interface TranscriptThread {
  callId: string;
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
  | { kind: "wave"; key: string; threads: TranscriptThread[] };

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
}

export type TranscriptTurn = UserTurn | ModelTurn;

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
  results: Map<string, string>;
  liveThreads: Record<string, RuntimeThread>;
  threadEvents: Record<string, AgentEvent[]>;
}

function describeThread(call: ToolCall, ctx: BuildContext): TranscriptThread {
  const args = parseArguments(call);
  const name = text(args.name) || "thread";
  const action = text(args.action);
  const live = ctx.liveThreads[name];
  const result = ctx.results.get(call.id) ?? null;

  const state: ThreadState = live?.isError
    ? "error"
    : result != null
      ? "done"
      : "running";

  return {
    callId: call.id,
    name,
    action,
    summary: result || action,
    // The persisted events are what a reload falls back on, and the stream is
    // what carries the commands issued since the last snapshot.
    log: mergeThreadLog(
      persistedThreadLog(ctx.threadEvents[name]),
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
    if (block.kind === kind) return block.text;
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
 */
function appendStreamedOutput(
  turns: TranscriptTurn[],
  stream: StreamedOutput,
): void {
  const reasoning = stream.reasoning.trim();
  const text = stream.text.trim();
  if (!reasoning && !text) return;

  let turn = turns[turns.length - 1];
  if (turn?.kind !== "model") {
    // The run answers with output before its first message is persisted, so the
    // turn it belongs to may not exist yet. It is keyed as the model turn it is
    // about to become, so committing the message does not remount it.
    const ordinal = turns.filter((entry) => entry.kind === "model").length;
    turn = {
      kind: "model",
      key: `model-${ordinal}`,
      blocks: [],
      durationMs: null,
    };
    turns.push(turn);
  }

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
  }
  if (text && !lastBlockText(turn.blocks, "text")?.includes(text)) {
    turn.blocks.push({
      kind: "text",
      key: `text-${nextOrdinal(turn.blocks, "text")}`,
      text,
    });
  }
}

/**
 * Group the snapshot messages into user bubbles and model messages. Live thread
 * state comes from the SSE store so a wave animates before the snapshot lands.
 */
export function buildTranscript(
  snapshot: SessionSnapshotResponse | null,
  liveThreads: Record<string, RuntimeThread>,
  stream?: StreamedOutput,
): TranscriptTurn[] {
  const messages = snapshot?.messages ?? [];
  const durations = snapshot?.response_timing.response_durations_ms ?? [];
  const createdAt = snapshot?.message_created_at ?? [];

  const results = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "tool") results.set(message.tool_call_id, message.content);
  }
  const ctx: BuildContext = {
    results,
    liveThreads,
    threadEvents: snapshot?.thread_events ?? {},
  };

  const turns: TranscriptTurn[] = [];
  let current: ModelTurn | null = null;
  // The backend times whole runs, and one run answers one prompt, so the
  // durations line up with model turns rather than assistant messages.
  let modelTurnIndex = -1;

  messages.forEach((message, index) => {
    if (message.role === "system" || message.role === "tool") return;

    if (message.role === "user") {
      current = null;
      turns.push({
        kind: "user",
        key: `user-${index}`,
        text: displayPromptFromMessageText(message.content),
        messageIndex: index,
        createdAt: createdAt[index] ?? null,
      });
      return;
    }

    if (!current) {
      modelTurnIndex += 1;
      current = {
        kind: "model",
        key: `model-${modelTurnIndex}`,
        blocks: [],
        durationMs: durations[modelTurnIndex] ?? null,
      };
      turns.push(current);
    }
    const blocks = current.blocks;

    const reasoning = message.reasoning_text?.trim();
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

    const content = (message.content ?? "").trim();
    if (content) {
      blocks.push({
        kind: "text",
        key: `text-${nextOrdinal(blocks, "text")}`,
        text: content,
      });
    }

    const wave: TranscriptThread[] = [];
    (message.tool_calls ?? []).forEach((call, callIndex) => {
      const name = call.function?.name ?? "tool";
      const key = `${name}-${index}-${callIndex}`;
      if (name === "thread") {
        wave.push(describeThread(call, ctx));
      } else if (name === "workset_define") {
        blocks.push({
          kind: "workset",
          key,
          worksetId: text(parseArguments(call).id),
          pending: !results.has(call.id),
        });
      } else {
        blocks.push({ kind: "tool", key, name, pending: !results.has(call.id) });
      }
    });
    if (wave.length) blocks.push({ kind: "wave", key: `wave-${index}`, threads: wave });
  });

  if (stream) appendStreamedOutput(turns, stream);

  return turns.length > MAX_TURNS ? turns.slice(-MAX_TURNS) : turns;
}
