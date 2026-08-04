// Turns the flat orchestrator message log into the blocks the chat renders.
//
// Everything the model does between two user prompts belongs to one model
// message: reasoning, prose, the worksets it defined and the waves of threads
// it dispatched. Tool calls issued together in a single assistant message ran
// in parallel, so each such assistant message becomes one wave.

import { displayPromptFromMessageText } from "@/app/lib/format";
import {
  THREAD_COMMAND_TAIL,
  type RuntimeThread,
} from "@/app/store/runtimeStore";
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
  /**
   * Reported result once the thread is done, or the tail of the commands it has
   * issued while it still runs — oldest first, so the newest reads at the
   * bottom of the card.
   */
  details: string[];
  state: ThreadState;
}

export type TranscriptBlock =
  | { kind: "thoughts"; key: string; text: string; durationMs: number | null }
  | { kind: "text"; key: string; text: string }
  | { kind: "workset"; key: string; worksetId: string; pending: boolean }
  | { kind: "tool"; key: string; name: string; pending: boolean }
  | { kind: "wave"; key: string; threads: TranscriptThread[] };

export interface UserTurn {
  kind: "user";
  key: string;
  text: string;
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

/**
 * Newest commands the thread reported, oldest first. Read from the persisted
 * events, which is what a reload has to fall back on; while the stream is
 * connected the store keeps a fresher copy of the same thing.
 */
function commandTail(events: AgentEvent[] | undefined, limit: number): string[] {
  const tail: string[] = [];
  for (let i = (events?.length ?? 0) - 1; i >= 0 && tail.length < limit; i -= 1) {
    const event = events?.[i];
    if (event?.type === "tool_call_started") {
      tail.push(`${event.name}: ${event.args_preview}`);
    }
  }
  return tail.reverse();
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

  let details: string[];
  if (state === "running") {
    const tail = live?.commands.length
      ? live.commands
      : commandTail(ctx.threadEvents[name], THREAD_COMMAND_TAIL);
    // Before the first command there is nothing to tail, so the card keeps
    // showing what the thread was asked to do.
    details = tail.length ? tail : [action];
  } else {
    details = [result || action];
  }

  return { callId: call.id, name, action, details, state };
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
    // turn it belongs to may not exist yet.
    turn = { kind: "model", key: "model-stream", blocks: [], durationMs: null };
    turns.push(turn);
  }

  if (reasoning && !lastBlockText(turn.blocks, "thoughts")?.includes(reasoning)) {
    turn.blocks.push({
      kind: "thoughts",
      key: "thoughts-stream",
      text: reasoning,
      durationMs: null,
    });
  }
  if (text && !lastBlockText(turn.blocks, "text")?.includes(text)) {
    turn.blocks.push({ kind: "text", key: "text-stream", text });
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
      });
      return;
    }

    if (!current) {
      modelTurnIndex += 1;
      current = {
        kind: "model",
        key: `model-${index}`,
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
        key: `thoughts-${index}`,
        text: reasoning,
        // The model call this message came out of, which for a reasoning model
        // is very nearly the time it spent thinking.
        durationMs: message.duration_ms ?? null,
      });
    }

    const content = (message.content ?? "").trim();
    if (content) blocks.push({ kind: "text", key: `text-${index}`, text: content });

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
