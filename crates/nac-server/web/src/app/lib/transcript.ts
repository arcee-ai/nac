// Turns the flat orchestrator message log into the blocks the chat renders.
//
// Everything the model does between two user prompts belongs to one model
// message: reasoning, prose, the worksets it defined and the waves of threads
// it dispatched. Tool calls issued together in a single assistant message ran
// in parallel, so each such assistant message becomes one wave.

import { displayPromptFromMessageText } from "@/app/lib/format";
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
  /** Reported result, or the command in flight while it still runs. */
  detail: string;
  state: ThreadState;
}

export type TranscriptBlock =
  | { kind: "thoughts"; key: string; text: string }
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

/** Newest command the thread reported, used as the subtitle while it runs. */
function lastCommand(events: AgentEvent[] | undefined): string {
  for (let i = (events?.length ?? 0) - 1; i >= 0; i -= 1) {
    const event = events?.[i];
    if (event?.type === "tool_call_started") {
      return `${event.name}: ${event.args_preview}`;
    }
  }
  return "";
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
  const detail =
    state === "running" ? lastCommand(ctx.threadEvents[name]) || action : result || action;

  return { callId: call.id, name, action, detail, state };
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
      blocks.push({ kind: "thoughts", key: `thoughts-${index}`, text: reasoning });
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

  return turns.length > MAX_TURNS ? turns.slice(-MAX_TURNS) : turns;
}
