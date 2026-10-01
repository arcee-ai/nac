/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act, render, type RenderResult } from "@testing-library/react";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { atomRefresh, isolatedRegistry } from "@/app/effect/remote";
import { useDelegatedPermissionStream, useSessionStream } from "@/app/hooks/useSessionStream";
import { api, apiEffect } from "@/app/services/api";
import { sessionSkillsAtom } from "@/app/services/queries/configuration";
import { sessionPermissionsAtom } from "@/app/services/queries/direct";
import {
  sessionSnapshotAtom,
  threadEventsAtom,
  threadEventsKey,
} from "@/app/services/queries/session";
import { resetRuntime } from "@/app/store/runtimeStore";
import type {
  Message,
  MessagePageMetadata,
  MessagesPageResponse,
  ResponseTimingSnapshot,
  SessionEventEnvelope,
  SessionSnapshotResponse,
} from "@/app/types/api";

// The hook runs against the real event stream. The tail page still goes through
// `api.getMessages`; snapshot and permission reloads go through `atomRefresh`.
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
vi.spyOn(apiEffect, "getThreadEvents").mockImplementation(() =>
  Effect.promise(() => new Promise(() => {})),
);

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

function DelegatedPermissionHarness() {
  useDelegatedPermissionStream("child-session", true);
  return null;
}

function successValue<A>(result: AsyncResult.AsyncResult<A, unknown>): A | undefined {
  return AsyncResult.isSuccess(result) ? result.value : undefined;
}

async function mount(
  registry = isolatedRegistry(),
): Promise<{ renderer: RenderResult; registry: ReturnType<typeof isolatedRegistry> }> {
  const renderer = render(
    <RegistryContext.Provider value={registry}>
      <Harness />
    </RegistryContext.Provider>,
  );
  await act(async () => undefined);
  return { renderer, registry };
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
  if (vi.isMockFunction(atomRefresh.run)) atomRefresh.run.mockRestore();
});

describe("session stream request coordination", () => {
  it("keeps a child permission stream live without mounting the child transcript", async () => {
    const registry = isolatedRegistry();
    const refresh = vi.spyOn(atomRefresh, "run").mockResolvedValue(undefined);
    const renderer = render(
      <RegistryContext.Provider value={registry}>
        <DelegatedPermissionHarness />
      </RegistryContext.Provider>,
    );
    await act(async () => undefined);
    const stream_source = source();
    expect(stream_source.url).toContain("/sessions/child-session/events/stream");

    await act(async () => stream_source.onopen?.());
    expect(refresh).toHaveBeenCalledWith(registry, sessionPermissionsAtom("child-session"));
    await act(async () => renderer.unmount());
    expect(stream_source.readyState).toBe(FakeEventSource.CLOSED);
  });

  it("coalesces a 100-commit burst into one in-flight tail and one follow-up", async () => {
    const registry = isolatedRegistry();
    registry.set(sessionSnapshotAtom(SESSION_ID), AsyncResult.success(snapshot([user("old")])));
    const first = deferred<MessagesPageResponse>();
    const firstReturned = deferred<void>();
    const second = deferred<MessagesPageResponse>();
    const refresh = vi.spyOn(atomRefresh, "run").mockResolvedValue(undefined);
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
    const { renderer } = await mount(registry);
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
    expect(refresh).not.toHaveBeenCalled();

    renderer.unmount();
    stream_source.emit("session_event", transcriptEnvelope(101));
    expect(stream.getPage).toHaveBeenCalledTimes(2);
    expect(stream_source.readyState).toBe(FakeEventSource.CLOSED);
  });

  it("keeps a superseding snapshot active before draining a queued tail", async () => {
    const registry = isolatedRegistry();
    registry.set(sessionSnapshotAtom(SESSION_ID), AsyncResult.success(snapshot([user("old")])));
    const firstSnapshot = deferred<void>();
    const secondSnapshot = deferred<void>();
    let snapshotInvalidations = 0;
    const refresh = vi.spyOn(atomRefresh, "run").mockImplementation(async (_registry, atom) => {
      if (atom !== sessionSnapshotAtom(SESSION_ID)) return;
      const pending = snapshotInvalidations === 0 ? firstSnapshot : secondSnapshot;
      snapshotInvalidations += 1;
      await pending.promise;
    });
    stream.getPage.mockResolvedValue(page([user("old"), user("new")], 4));
    const { renderer } = await mount(registry);
    const stream_source = source();

    await act(async () => {
      stream_source.emit("replay_boundary", { epoch_id: "one" });
      stream_source.emit("replay_boundary", { epoch_id: "two" });
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(snapshotInvalidations).toBe(1);
    expect(refresh).toHaveBeenCalledWith(registry, sessionSkillsAtom(SESSION_ID));
    expect(refresh).toHaveBeenCalledWith(registry, sessionPermissionsAtom(SESSION_ID));

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
    const registry = isolatedRegistry();
    registry.set(sessionSnapshotAtom(SESSION_ID), AsyncResult.success(snapshot([user("old")])));
    const refresh = vi.spyOn(atomRefresh, "run").mockResolvedValue(undefined);
    const { renderer } = await mount(registry);
    const stream_source = source();

    await act(async () => {
      stream_source.emit("replay_gap", { missing_from_sequence_id: 4 });
      stream_source.emit("lagged", { skipped: 3 });
    });

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenNthCalledWith(1, registry, sessionPermissionsAtom(SESSION_ID));
    expect(refresh).toHaveBeenNthCalledWith(2, registry, sessionPermissionsAtom(SESSION_ID));

    await act(async () => renderer.unmount());
  });

  it("rejects a late tail after a destructive replay fence", async () => {
    const registry = isolatedRegistry();
    const accepted = snapshot([user("accepted")]);
    registry.set(sessionSnapshotAtom(SESSION_ID), AsyncResult.success(accepted));
    registry.set(
      threadEventsAtom(threadEventsKey(SESSION_ID, "worker")),
      AsyncResult.success({
        pages: [{ events: [{ id: 1 }], has_older: false, next_before_id: null }],
        pageParams: [null],
      } as never),
    );
    const late = deferred<MessagesPageResponse>();
    stream.getPage.mockImplementation(() => late.promise);
    const { renderer } = await mount(registry);
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
    expect(
      successValue(registry.get(threadEventsAtom(threadEventsKey(SESSION_ID, "worker")))),
    ).toBeUndefined();

    await act(async () => {
      late.resolve(page([user("stale")], 1));
      await late.promise;
    });
    expect(successValue(registry.get(sessionSnapshotAtom(SESSION_ID)))).toBe(accepted);

    await act(async () => renderer.unmount());
  });
});
