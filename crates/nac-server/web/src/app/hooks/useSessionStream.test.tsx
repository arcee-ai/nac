/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, type RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionStream } from "@/app/hooks/useSessionStream";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import { resetRuntime } from "@/app/store/runtimeStore";
import type {
  Message,
  MessagePageMetadata,
  MessagesPageResponse,
  ResponseTimingSnapshot,
  SessionEventEnvelope,
  SessionSnapshotResponse,
} from "@/app/types/api";

// The hook runs against the real event stream and api modules; the only fakes
// are the EventSource global, which jsdom does not implement, and the page
// fetch, which a spy on the real api object delegates to.
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, (event: MessageEvent<string>) => void>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: EventListenerOrEventListenerObject) {
    // SAFETY: the fake only ever emits MessageEvents, so a listener registered
    // for one is invoked with exactly that shape.
    this.listeners.set(name, listener as (event: MessageEvent<string>) => void);
  }

  emit<T>(name: string, value: T) {
    // A closed source stops delivering events, like a real EventSource.
    if (this.readyState === FakeEventSource.CLOSED) return;
    const event = new MessageEvent<string>(name, {
      data: JSON.stringify(value),
    });
    this.listeners.get(name)?.(event);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

function source(): FakeEventSource {
  const instance = FakeEventSource.instances.at(-1);
  if (!instance) throw new Error("expected an open event stream");
  return instance;
}

const stream = {
  getPage: vi.fn(),
};

vi.spyOn(api, "getMessages").mockImplementation((...args) => stream.getPage(...args));

const SESSION_ID = "stream-test";

function deferred<T>() {
  return Promise.withResolvers<T>();
}

async function flushAsyncWork() {
  for (let flush = 0; flush < 10; flush += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
}
function user(content: string): Message {
  // SAFETY: test fixture — the user variant is exactly { role, content }.
  return { role: "user", content } as Message;
}

function snapshot(messages: Message[], total = messages.length): SessionSnapshotResponse {
  const messagePage: MessagePageMetadata = {
    start: 0,
    end: messages.length,
    total,
    has_older: false,
  };
  const timing: ResponseTimingSnapshot = {
    last_response_duration_ms: null,
    previous_response_duration_ms: null,
    response_durations_ms: [],
  };
  // SAFETY: test fixture — only the snapshot fields the stream coordination
  // under test reads are populated; the remaining response fields are unused.
  return {
    messages,
    message_created_at: messages.map((_, index) => `t-${index}`),
    message_page: messagePage,
    response_timing: timing,
    thread_events: {},
    thread_episodes: {},
  } as SessionSnapshotResponse;
}

function page(messages: Message[], total = messages.length): MessagesPageResponse {
  return {
    messages,
    created_at: messages.map((_, index) => `t-${index}`),
    page: {
      start: 0,
      end: messages.length,
      total,
      has_older: false,
    },
  };
}

function transcriptEnvelope(sequenceId: number): SessionEventEnvelope {
  // SAFETY: test fixture — the hook reads only sequence_id and the event
  // payload the fixture provides; the remaining envelope fields are omitted.
  return {
    sequence_id: sequenceId,
    event: { type: "transcript_appended", transcript_len: sequenceId + 1 },
  } as SessionEventEnvelope;
}

function Harness() {
  useSessionStream(SESSION_ID);
  return null;
}

async function mount(client: QueryClient): Promise<RenderResult> {
  const renderer = render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  await act(async () => undefined);
  return renderer;
}
beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  stream.getPage.mockReset();
  resetRuntime(SESSION_ID);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("session stream request coordination", () => {
  it("coalesces a 100-commit burst into one in-flight tail and one follow-up", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(queryKeys.sessionSnapshot(SESSION_ID), snapshot([user("old")]));
    const first = deferred<MessagesPageResponse>();
    const firstReturned = deferred<void>();
    const second = deferred<MessagesPageResponse>();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    let inFlight = 0;
    let maxInFlight = 0;
    stream.getPage
      .mockImplementationOnce(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const value = await first.promise;
        inFlight -= 1;
        firstReturned.resolve();
        return value;
      })
      .mockImplementationOnce(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const value = await second.promise;
        inFlight -= 1;
        return value;
      });
    const renderer = await mount(client);
    const stream_source = source();

    await act(async () => {
      for (let sequence = 1; sequence <= 100; sequence += 1) {
        stream_source.emit("session_event", transcriptEnvelope(sequence));
      }
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(stream.getPage).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(page([user("old"), user("new")], 2));
      await firstReturned.promise;
      await flushAsyncWork();
    });
    await vi.waitFor(() => {
      expect(stream.getPage).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      second.resolve(page([user("old"), user("new")], 2));
      await second.promise;
      await flushAsyncWork();
    });
    expect(stream.getPage).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
    expect(
      stream.getPage.mock.calls.every(
        (call) => call[1]?.limit === 24 && call[1]?.includeSystem === true,
      ),
    ).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();

    renderer.unmount();
    stream_source.emit("session_event", transcriptEnvelope(101));
    expect(stream.getPage).toHaveBeenCalledTimes(2);
    expect(stream_source.readyState).toBe(FakeEventSource.CLOSED);
  });

  it("keeps a superseding snapshot active before draining a queued tail", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(queryKeys.sessionSnapshot(SESSION_ID), snapshot([user("old")]));
    const firstSnapshot = deferred<void>();
    const secondSnapshot = deferred<void>();
    let snapshotInvalidations = 0;
    const invalidate = vi.spyOn(client, "invalidateQueries").mockImplementation(async (filters) => {
      if (filters?.queryKey?.toString() !== queryKeys.sessionSnapshot(SESSION_ID).toString()) {
        return;
      }
      const pending = snapshotInvalidations === 0 ? firstSnapshot : secondSnapshot;
      snapshotInvalidations += 1;
      await pending.promise;
    });
    stream.getPage.mockResolvedValue(page([user("old"), user("new")], 4));
    const renderer = await mount(client);
    const stream_source = source();

    await act(async () => {
      stream_source.emit("replay_boundary", { epoch_id: "one" });
      stream_source.emit("replay_boundary", { epoch_id: "two" });
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(snapshotInvalidations).toBe(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.sessionSkills(SESSION_ID),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.sessionPermissions(SESSION_ID),
      exact: true,
    });

    await act(async () => {
      stream_source.emit("replay_boundary", { epoch_id: "three" });
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(snapshotInvalidations).toBe(2);
    await act(async () => {
      firstSnapshot.resolve();
      await firstSnapshot.promise;
    });
    expect(snapshotInvalidations).toBe(2);

    await act(async () => {
      stream_source.emit("session_event", transcriptEnvelope(3));
    });
    expect(stream.getPage).not.toHaveBeenCalled();

    await act(async () => {
      secondSnapshot.resolve();
      await secondSnapshot.promise;
    });
    expect(stream.getPage).toHaveBeenCalledOnce();

    await act(async () => renderer.unmount());
  });

  it("refreshes permission state when replay loss makes exact events unknowable", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(queryKeys.sessionSnapshot(SESSION_ID), snapshot([user("old")]));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const renderer = await mount(client);
    const stream_source = source();

    await act(async () => {
      stream_source.emit("replay_gap", { missing_from_sequence_id: 4 });
      stream_source.emit("lagged", { skipped: 3 });
    });

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenNthCalledWith(1, {
      queryKey: queryKeys.sessionPermissions(SESSION_ID),
      exact: true,
    });
    expect(invalidate).toHaveBeenNthCalledWith(2, {
      queryKey: queryKeys.sessionPermissions(SESSION_ID),
      exact: true,
    });

    await act(async () => renderer.unmount());
  });

  it("rejects a late tail after a destructive replay fence", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const accepted = snapshot([user("accepted")]);
    client.setQueryData(queryKeys.sessionSnapshot(SESSION_ID), accepted);
    client.setQueryData(queryKeys.threadEvents(SESSION_ID, "worker"), {
      pages: [{ events: [{ id: 1 }], has_older: false }],
      pageParams: [null],
    });
    const late = deferred<MessagesPageResponse>();
    stream.getPage.mockImplementation(() => late.promise);
    const renderer = await mount(client);
    const stream_source = source();

    await act(async () => {
      stream_source.emit("session_event", transcriptEnvelope(1));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(stream.getPage).toHaveBeenCalledOnce();

    await act(async () => {
      stream_source.emit("replay_gap", { missing_from_sequence_id: 1 });
    });
    expect(client.getQueryData(queryKeys.threadEvents(SESSION_ID, "worker"))).toBeUndefined();

    await act(async () => {
      late.resolve(page([user("stale")], 1));
      await late.promise;
    });
    expect(client.getQueryData(queryKeys.sessionSnapshot(SESSION_ID))).toBe(accepted);

    await act(async () => renderer.unmount());
  });
});
