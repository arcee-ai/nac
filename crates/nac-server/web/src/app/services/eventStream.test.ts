/** @vitest-environment jsdom */

import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/app/lib/perfDebug", () => ({
  perfEpoch: vi.fn(),
  perfMark: vi.fn(),
}));

import { perfEpoch, perfMark } from "@/app/lib/perfDebug";
import { subscribeToSessionEvents } from "@/app/services/eventStream";

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, (event: MessageEvent<string>) => void>();

  constructor() {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(name, listener as (event: MessageEvent<string>) => void);
  }

  emit(name: string, value: unknown) {
    this.listeners.get(name)?.(new MessageEvent<string>(name, { data: JSON.stringify(value) }));
  }

  close() {}
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("preserves standalone performance instrumentation around the shared stream", async () => {
  const onSessionEvent = vi.fn();
  const onAssistantDelta = vi.fn();
  const dispose = subscribeToSessionEvents(
    "session-a",
    { onEnvelope: vi.fn() },
    { instrumentation: { onSessionEvent, onAssistantDelta } },
  );
  const source = FakeEventSource.instances[0];

  const envelope = {
    session_id: "session-a",
    epoch_id: "epoch-a",
    sequence_id: 1,
    event: { type: "run_failed", message: "failed" },
  } as const;
  source.emit("session_event", envelope);
  await Promise.resolve();

  expect(perfMark).toHaveBeenCalledWith("sse:session_event", {
    fields: { type: "run_failed" },
    throttleMs: 0,
  });
  expect(onSessionEvent).toHaveBeenCalledWith(envelope);

  const delta = { text: "hello", reasoning: "why" };
  source.emit("assistant_delta", delta);
  expect(perfEpoch).toHaveBeenCalledOnce();
  expect(perfMark).toHaveBeenCalledWith("sse:assistant_delta", {
    fields: { chars: 8 },
    throttleMs: 1000,
  });
  expect(onAssistantDelta).toHaveBeenCalledWith(delta);
  dispose();
});
