/** @vitest-environment jsdom */

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { subscribeToSessionEvents } from "@/app/services/eventStream";

vi.mock("@/app/services/api", () => ({
  api: {
    eventStreamUrl: (sessionId: string) => `/sessions/${sessionId}/events/stream`,
  },
}));

vi.mock("@/app/lib/perfDebug", () => ({
  perfEpoch: vi.fn(),
  perfMark: vi.fn(),
}));

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
    this.listeners.set(name, listener as (event: MessageEvent<string>) => void);
  }

  emit(name: string, value: unknown) {
    this.listeners.get(name)?.({ data: JSON.stringify(value) } as MessageEvent<string>);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reconnects with the epoch and sequence as one cursor", async () => {
  const dispose = subscribeToSessionEvents("session-a", {
    onEnvelope: vi.fn(),
  });
  const first = FakeEventSource.instances[0];
  first.readyState = FakeEventSource.OPEN;
  first.onopen?.();
  first.emit("replay_boundary", {
    epoch_id: "epoch-a",
    replay_boundary_sequence_id: 0,
  });
  first.emit("session_event", {
    session_id: "session-a",
    epoch_id: "epoch-a",
    sequence_id: 7,
    event: { type: "run_failed", message: "failed" },
  });

  first.onerror?.();
  expect(first.readyState).toBe(FakeEventSource.CLOSED);
  await vi.advanceTimersByTimeAsync(1_000);

  expect(FakeEventSource.instances).toHaveLength(2);
  expect(FakeEventSource.instances[1].url).toBe(
    "/sessions/session-a/events/stream?after_epoch_id=epoch-a&after_sequence_id=7",
  );
  dispose();
});

it("replaces an old-epoch cursor with the new replay boundary", async () => {
  const dispose = subscribeToSessionEvents("session-a", {
    onEnvelope: vi.fn(),
  });
  const first = FakeEventSource.instances[0];
  first.emit("session_event", {
    session_id: "session-a",
    epoch_id: "epoch-a",
    sequence_id: 7,
    event: { type: "run_failed", message: "failed" },
  });
  first.emit("replay_boundary", {
    epoch_id: "epoch-b",
    replay_boundary_sequence_id: 2,
  });

  first.onerror?.();
  await vi.advanceTimersByTimeAsync(1_000);

  expect(FakeEventSource.instances[1].url).toBe(
    "/sessions/session-a/events/stream?after_epoch_id=epoch-b&after_sequence_id=2",
  );
  dispose();
});

it("does not advance a same-epoch cursor past replayed events", async () => {
  const dispose = subscribeToSessionEvents("session-a", {
    onEnvelope: vi.fn(),
  });
  const first = FakeEventSource.instances[0];
  first.emit("session_event", {
    session_id: "session-a",
    epoch_id: "epoch-a",
    sequence_id: 3,
    event: { type: "run_failed", message: "failed" },
  });
  first.emit("replay_boundary", {
    epoch_id: "epoch-a",
    replay_boundary_sequence_id: 7,
  });

  first.onerror?.();
  await vi.advanceTimersByTimeAsync(1_000);

  expect(FakeEventSource.instances[1].url).toBe(
    "/sessions/session-a/events/stream?after_epoch_id=epoch-a&after_sequence_id=3",
  );
  dispose();
});

it("keeps the cursor absent when no event has been observed", async () => {
  const dispose = subscribeToSessionEvents("session-a", {
    onEnvelope: vi.fn(),
  });
  const first = FakeEventSource.instances[0];
  first.emit("replay_boundary", {
    epoch_id: "epoch-a",
    replay_boundary_sequence_id: 7,
  });

  first.onerror?.();
  await vi.advanceTimersByTimeAsync(1_000);

  expect(FakeEventSource.instances[1].url).toBe(
    "/sessions/session-a/events/stream",
  );
  dispose();
});
