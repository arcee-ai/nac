/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, type RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionStream } from "@/app/hooks/useSessionStream";
import type { SessionStreamHandlers } from "@/app/services/eventStream";
import { queryKeys } from "@/app/services/queries";
import { resetRuntime } from "@/app/store/runtimeStore";
import type {
  Message,
  MessagesPageResponse,
  SessionEventEnvelope,
  SessionSnapshotResponse,
} from "@/app/types/api";

const stream = vi.hoisted(() => ({

  handlers: null as SessionStreamHandlers | null,
  getPage: vi.fn(),
  disposed: vi.fn(),
}));

vi.mock("@/app/services/eventStream", () => ({
  subscribeToSessionEvents: (_id: string, handlers: SessionStreamHandlers) => {
    stream.handlers = handlers;
    return stream.disposed;
  },
}));

vi.mock("@/app/services/api", () => ({
  api: {
    getMessages: stream.getPage,
  },
}));

vi.mock("@/app/lib/perfDebug", () => ({
  perfMark: vi.fn(),
  perfRender: vi.fn(),
  perfTime: (_name: string, run: () => unknown) => run(),
}));

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
  return { role: "user", content } as Message;
}

function snapshot(messages: Message[], total = messages.length): SessionSnapshotResponse {
  return {
    messages,
    message_created_at: messages.map((_, index) => `t-${index}`),
    message_page: {
      start: 0,
      end: messages.length,
      total,
      has_older: false,
    },
    response_timing: { response_durations_ms: [] },
    thread_events: {},
    thread_episodes: {},
  } as unknown as SessionSnapshotResponse;
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
  stream.handlers = null;
  stream.getPage.mockReset();
  stream.disposed.mockReset();
  resetRuntime(SESSION_ID);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("session stream request coordination", () => {
  it("coalesces a 100-commit burst into one in-flight tail and one follow-up", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      queryKeys.sessionSnapshot(SESSION_ID),
      snapshot([user("old")]),
    );
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
    expect(stream.handlers).not.toBeNull();

    await act(async () => {
      for (let sequence = 1; sequence <= 100; sequence += 1) {
        stream.handlers?.onEnvelope(transcriptEnvelope(sequence));
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
    stream.handlers?.onEnvelope(transcriptEnvelope(101));
    expect(stream.getPage).toHaveBeenCalledTimes(2);
    expect(stream.disposed).toHaveBeenCalledOnce();
  });

  it("keeps a superseding snapshot active before draining a queued tail", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(queryKeys.sessionSnapshot(SESSION_ID), snapshot([user("old")]));
    const firstSnapshot = deferred<void>();
    const secondSnapshot = deferred<void>();
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockImplementationOnce(async () => firstSnapshot.promise)
      .mockImplementationOnce(async () => secondSnapshot.promise);
    stream.getPage.mockResolvedValue(page([user("old"), user("new")], 4));
    const renderer = await mount(client);
    expect(stream.handlers).not.toBeNull();

    await act(async () => {
      stream.handlers?.onReplayBoundary?.({ epoch_id: "one" } as never);
      stream.handlers?.onReplayBoundary?.({ epoch_id: "two" } as never);
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(invalidate).toHaveBeenCalledTimes(1);

    await act(async () => {
      stream.handlers?.onReplayBoundary?.({ epoch_id: "three" } as never);
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(invalidate).toHaveBeenCalledTimes(2);
    await act(async () => {
      firstSnapshot.resolve();
      await firstSnapshot.promise;
    });
    expect(invalidate).toHaveBeenCalledTimes(2);

    await act(async () => {
      stream.handlers?.onEnvelope(transcriptEnvelope(3));
    });
    expect(stream.getPage).not.toHaveBeenCalled();

    await act(async () => {
      secondSnapshot.resolve();
      await secondSnapshot.promise;
    });
    expect(stream.getPage).toHaveBeenCalledOnce();

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
    expect(stream.handlers).not.toBeNull();

    await act(async () => {
      stream.handlers?.onEnvelope(transcriptEnvelope(1));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(stream.getPage).toHaveBeenCalledOnce();

    await act(async () => {
      stream.handlers?.onReplayGap?.({ missing_from_sequence_id: 1 } as never);
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
