import { describe, expect, it } from "vitest";

import {
  buildTranscript,
  dispatchThreadName,
  partitionThreadCalls,
  type TranscriptThread,
} from "@/app/lib/transcript";
import type { RuntimeThread } from "@/app/store/runtimeStore";
import type {
  AgentEvent,
  Message,
  SessionSnapshotResponse,
  ThreadSnapshot,
  ToolCall,
} from "@/app/types/api";

interface DispatchSpec {
  name: string;
  callId: string;
  threads?: string[];
}

/** Wire shape of the orchestrator's `thread` tool arguments. */
interface DispatchArguments {
  name: string;
  action: string;
  threads?: string[];
}

function dispatchToolCall(spec: DispatchSpec): ToolCall {
  const args: DispatchArguments = {
    name: spec.name,
    action: spec.callId,
  };
  if (spec.threads) {
    args.threads = spec.threads;
  }
  return {
    id: spec.callId,
    type: "function",
    function: { name: "thread", arguments: JSON.stringify(args) },
  };
}

function rawThreadCall(argumentsJson: string): ToolCall {
  return {
    id: "raw-call",
    type: "function",
    function: { name: "thread", arguments: argumentsJson },
  };
}

function threadCall(name: string, callId: string): Message {
  return threadBatch([{ name, callId }]);
}

function threadBatch(calls: DispatchSpec[]): Message {
  return {
    role: "assistant",
    content: null,
    tool_calls: calls.map(dispatchToolCall),
  };
}

function toolResult(callId: string): Message {
  return { role: "tool", tool_call_id: callId, content: "done" };
}

function imageToolResult(callId: string): Message {
  return {
    role: "tool",
    tool_call_id: callId,
    content: [
      {
        type: "image",
        image: { mime_type: "image/png", data: "base64-payload" },
      },
    ],
  };
}

function threadSnapshot(name: string, episodeCount: number): ThreadSnapshot {
  return {
    name,
    session_id: "session-test",
    created_at: "t-0",
    updated_at: "t-0",
    episode_count: episodeCount,
    latest_action: null,
  };
}

function snapshot(messages: Message[]): SessionSnapshotResponse {
  return {
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
    message_page: {
      start: 0,
      end: messages.length,
      total: messages.length,
      has_older: false,
    },
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
}

function threadStarted(name: string): AgentEvent {
  return {
    type: "thread_started",
    name,
    action: "dispatched",
    source_threads: [],
  };
}

function threadFinished(name: string): AgentEvent {
  return { type: "thread_finished", name, exit_code: 0, timed_out: false };
}

function liveThread(name: string, status: RuntimeThread["status"]): RuntimeThread {
  return {
    name,
    status,
    cancelled: false,
    exitCode: null,
    isError: false,
    log: [],
  };
}

function waveCards(turns: ReturnType<typeof buildTranscript>): TranscriptThread[] {
  return turns.flatMap((turn) =>
    turn.kind === "model"
      ? turn.blocks.flatMap((block) => (block.kind === "wave" ? block.rows.flat() : []))
      : [],
  );
}

describe("re-dispatched thread cards", () => {
  // The messages tail merge learns about the new dispatch's tool call right
  // away, but the snapshot's per-thread event window only gains its
  // thread_started on the refetch the start triggers. In between, the window
  // still ends at the previous episode's thread_finished.
  function redispatchSnapshot(): SessionSnapshotResponse {
    const value = snapshot([
      threadCall("worker", "call-1"),
      toolResult("call-1"),
      threadCall("worker", "call-2"),
    ]);
    value.threads = [threadSnapshot("worker", 1)];
    value.thread_events = {
      worker: [threadStarted("worker"), threadFinished("worker")],
    };
    return value;
  }

  it("keeps the newest card running while its start event has not reached the snapshot", () => {
    const cards = waveCards(
      buildTranscript(redispatchSnapshot(), {
        worker: liveThread("worker", "running"),
      }),
    );

    expect(cards).toHaveLength(2);
    expect(cards[0].state).toBe("done");
    expect(cards[1].state).toBe("running");
  });

  it("still marks the newest card done once its own dispatch finished", () => {
    const cards = waveCards(
      buildTranscript(redispatchSnapshot(), {
        worker: liveThread("worker", "finished"),
      }),
    );

    expect(cards[1].state).toBe("done");
  });

  it("reads the caught-up window without leaning on the live stream", () => {
    const value = redispatchSnapshot();
    value.thread_events = {
      worker: [threadStarted("worker"), threadFinished("worker"), threadStarted("worker")],
    };

    const cards = waveCards(buildTranscript(value, {}));

    expect(cards[0].state).toBe("done");
    expect(cards[1].state).toBe("running");
  });

  it("keeps a dependent pending while its re-dispatched source is running", () => {
    const value = snapshot([
      threadCall("source", "call-1"),
      toolResult("call-1"),
      threadBatch([
        { name: "source", callId: "call-2" },
        { name: "dependent", callId: "call-3", threads: ["source"] },
      ]),
    ]);
    value.threads = [threadSnapshot("source", 1)];
    value.thread_events = {
      source: [threadStarted("source"), threadFinished("source")],
    };

    const cards = waveCards(buildTranscript(value, { source: liveThread("source", "running") }));

    const source = cards.filter((card) => card.name === "source").at(-1);
    const dependent = cards.find((card) => card.name === "dependent");
    expect(source?.state).toBe("running");
    expect(dependent?.state).toBe("pending");
  });

  it("renders typed image results as bounded placeholders", () => {
    const cards = waveCards(
      buildTranscript(
        snapshot([
          threadCall("worker", "call-image"),
          imageToolResult("call-image"),
        ]),
        {},
      ),
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].state).toBe("done");
    expect(cards[0].summary).toBe("[Image: image/png]");
    expect(cards[0].summary).not.toContain("base64-payload");
  });
});

describe("thread call decoding", () => {
  it("falls back when a decoded name is not a string", () => {
    const call = rawThreadCall('{"name":{"toString":null},"action":"x"}');

    expect(dispatchThreadName(call)).toBe("thread");
  });

  it("ignores non-string dependency entries", () => {
    const first = rawThreadCall('{"name":"first","action":"x"}');
    const second = rawThreadCall('{"name":"second","action":"y","threads":[{"toString":null}]}');

    expect(partitionThreadCalls([first, second])).toEqual([[first, second]]);
  });
});
