import type { ToolPresentation } from "@/app/lib/toolPresentation";
import type {
  DelegatedCompletionTurn,
  ModelTurn,
  TranscriptBlock,
  TranscriptThread,
  UserTurn,
} from "@/app/lib/transcript";
import type { Message, SessionBehavior, SessionSnapshotResponse, ToolCall } from "@/app/types/api";

type ThoughtsBlock = Extract<TranscriptBlock, { kind: "thoughts" }>;

export function snapshot(messages: Message[], behavior?: SessionBehavior): SessionSnapshotResponse {
  const value: SessionSnapshotResponse = {
    metadata: {
      cwd: "/tmp/nac-test",
      workspace_host_path: null,
      store_path: "/tmp/nac-test/store.db",
      model: "test-model",
      backend: "test-backend",
      session_id: "session-test",
      sandbox_status: "off",
      agents_md_status: "missing",
    },
    messages,
    message_created_at: messages.map((_, index) => `t-${index}`),
    message_page: { start: 0, end: messages.length, total: messages.length, has_older: false },
    response_timing: {
      last_response_duration_ms: null,
      previous_response_duration_ms: null,
      response_durations_ms: [],
    },
    sessions: [],
    active_threads: [],
    threads: [],
    thread_episodes: {},
    thread_events: {},
    thread_event_boundary: { epoch_id: "epoch-test", sequence_id: 0 },
    thread_steering: [],
    worksets: { items: [], error: null },
    workspace: {
      host_root: null,
      workspace_display: "nac-test",
      repo_label: null,
      branch: null,
      changed_files: [],
      total_additions: 0,
      total_deletions: 0,
      error: null,
    },
  };
  if (behavior) value.metadata.behavior = behavior;
  return value;
}

export function toolCall(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

export function assistant(
  options: { reasoning?: string; content?: string; calls?: ToolCall[] } = {},
): Message {
  return {
    role: "assistant",
    content: options.content ?? null,
    reasoning_text: options.reasoning ?? null,
    tool_calls: options.calls ?? null,
  };
}

export function toolResult(callId: string, content = "done"): Message {
  return { role: "tool", tool_call_id: callId, content };
}

export function presentation(
  name: string,
  overrides: Partial<ToolPresentation> = {},
): ToolPresentation {
  return {
    callId: `call-${name}`,
    name,
    label: name,
    summary: null,
    resultPreview: null,
    status: "success",
    statusLabel: "Succeeded",
    ...overrides,
  };
}

export function thoughts(key: string, overrides: Partial<ThoughtsBlock> = {}): ThoughtsBlock {
  return {
    kind: "thoughts",
    key,
    text: "Checking how the store is wired.",
    durationMs: null,
    streaming: false,
    ...overrides,
  };
}

export function text(key: string, value = "Here is what changed."): TranscriptBlock {
  return { kind: "text", key, text: value };
}

export function toolDetail(
  name: string,
  overrides: Partial<ToolPresentation> = {},
): Extract<TranscriptBlock, { kind: "tool-detail" }> {
  const value = presentation(name, overrides);
  return { kind: "tool-detail", key: `tool-${value.callId}`, presentation: value };
}

export function compactTool(key: string, name: string, pending = false): TranscriptBlock {
  return { kind: "tool", key, name, pending };
}

export function workset(key: string, worksetId: string, pending = false): TranscriptBlock {
  return { kind: "workset", key, worksetId, pending };
}

export function thread(
  name: string,
  key: string,
  overrides: Partial<TranscriptThread> = {},
): TranscriptThread {
  return {
    key,
    name,
    action: `Work on ${name}`,
    weight: null,
    summary: `Work on ${name}`,
    log: [],
    state: "done",
    ...overrides,
  };
}

export function wave(key: string, rows: TranscriptThread[][]): TranscriptBlock {
  return { kind: "wave", key, rows };
}

export function userTurn(
  index: number,
  prompt = `Prompt ${index}`,
  createdAt: string | null = null,
): UserTurn {
  return {
    kind: "user",
    key: `user-${index}`,
    text: prompt,
    invokedSkills: null,
    messageIndex: index,
    createdAt,
  };
}

export function modelTurn(index: number, blocks: TranscriptBlock[]): ModelTurn {
  return { kind: "model", key: `model-${index}`, blocks, durationMs: null, messageIndex: index };
}

export function completionTurn(index: number): DelegatedCompletionTurn {
  return {
    kind: "delegated-completion",
    key: `delegated-completion-${index}`,
    completion: {
      kind: "coding-agent",
      sessionId: "child-session",
      generation: 1,
      status: "completed",
      description: "Fix the flaky test",
      outcome: "Done.",
      changes: null,
      verification: null,
    },
    messageIndex: index,
    createdAt: null,
  };
}
