import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NacClient } from "./nacClient.js";
import { subscribeToSessionEventsWithWire } from "./eventStream.js";
import {
  exactSessionCursorProtocol,
  type ExactSessionCursor,
  type SessionStreamFrames,
  type SessionStreamWire,
} from "./sessionStreamWire.js";

// Synthetic protocol fixtures, not a declaration of the pending public event DTO.
interface Envelope {
  epoch: string;
  sequence: string;
  session: string;
  run: string;
  clientReference: string;
}
interface Frames extends SessionStreamFrames {
  envelope: Envelope;
  cursor: ExactSessionCursor;
  sequence: string;
}
class Stream {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners = new Map<string, EventListenerOrEventListenerObject>();
  addEventListener(name: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(name, listener);
  }
  emit(name: string, text: string) {
    const listener = this.listeners.get(name);
    const event = new MessageEvent(name, { data: text });
    if (typeof listener === "function") listener(event);
    else listener?.handleEvent(event);
  }
  close() {
    this.closed = true;
  }
}
const dispose: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const close of dispose.splice(0)) close();
  vi.useRealTimers();
});

function fixture(initialCursor: ExactSessionCursor | null = null) {
  const payloads = new Map<string, Envelope>();
  const decoder = vi.fn((text: string) => {
    const value = payloads.get(text);
    if (!value || value.session !== "session") throw new Error("Invalid synthetic frame.");
    return value;
  });
  const wire: SessionStreamWire<Frames> = {
    streamPath: (id) => `/synthetic/${encodeURIComponent(id)}/events`,
    decodeEnvelope: decoder,
    decodeAssistantDelta: (text) => text,
    decodeReplayBoundary: decoder,
    decodeReplayGap: (text) => text,
    decodeLagged: (text) => text,
    cursorFromEnvelope: (value) => ({ epoch: value.epoch, sequence: value.sequence }),
    cursorFromBoundary: (value) => {
      if (
        !value ||
        typeof value !== "object" ||
        !("epoch" in value) ||
        !("sequence" in value) ||
        typeof value.epoch !== "string" ||
        typeof value.sequence !== "string"
      )
        throw new Error("Invalid synthetic boundary.");
      return { epoch: value.epoch, sequence: value.sequence };
    },
    cursor: exactSessionCursorProtocol,
    invalidFrame: "stop",
    epochPolicy: "replay-boundary",
  };
  const opened: { url: string; stream: Stream; header: string | undefined }[] = [];
  let credentials = 0;
  const client = new NacClient({
    endpoint: "/bound",
    headers: () => ({ "X-Test-Open": String(++credentials) }),
  });
  const onEnvelope = vi.fn();
  const onSequenceGap = vi.fn();
  const onDuplicate = vi.fn();
  const onTransportError = vi.fn();
  const close = subscribeToSessionEventsWithWire(
    "session",
    { onEnvelope, onSequenceGap, onDuplicate, onTransportError },
    wire,
    {
      client,
      initialCursor,
      eventSource: (url, _init, context) => {
        const stream = new Stream();
        opened.push({ url, stream, header: context.headers["x-test-open"] });
        return stream as unknown as EventSource;
      },
    },
  );
  dispose.push(close);
  const send = (
    name: string,
    sequence: string,
    epoch = "epoch",
    index = opened.length - 1,
    session = "session",
  ) => {
    const value = { epoch, sequence, session, run: "run", clientReference: "client" };
    const text = JSON.stringify(value);
    payloads.set(text, value);
    opened[index].stream.emit(name, text);
    return { value, text };
  };
  return { opened, send, close, decoder, onEnvelope, onSequenceGap, onDuplicate, onTransportError };
}

it("delivers adjacent exact cursors with unchanged correlation and rejects duplicates/gaps", async () => {
  const f = fixture({ epoch: "epoch", sequence: "9007199254740991" });
  await vi.waitFor(() => expect(f.opened).toHaveLength(1));
  f.opened[0].stream.onopen?.();
  f.send("replay_boundary", "9007199254740991");
  const first = f.send("session_event", "9007199254740992");
  f.send("session_event", "9007199254740993");
  await vi.waitFor(() => expect(f.onEnvelope).toHaveBeenCalledTimes(2));
  expect(f.onEnvelope.mock.calls[0][0]).toBe(first.value);
  expect(f.decoder).toHaveBeenCalledWith(first.text);
  f.send("session_event", "9007199254740993");
  expect(f.onDuplicate).toHaveBeenCalledOnce();
  f.send("session_event", "9007199254740995");
  expect(f.onSequenceGap).toHaveBeenCalledWith({
    epochId: "epoch",
    expectedSequenceId: "9007199254740994",
    receivedSequenceId: "9007199254740995",
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(f.opened).toHaveLength(2);
  expect(f.opened[1].url).toContain("after_sequence_id=9007199254740993");
  expect(f.opened.map((entry) => entry.header)).toEqual(["1", "2"]);
});

it("rotates a finite connection with the exact maximum u64 cursor and fresh headers", async () => {
  const f = fixture();
  await vi.waitFor(() => expect(f.opened).toHaveLength(1));
  f.opened[0].stream.onopen?.();
  f.send("replay_boundary", "18446744073709551615");
  f.send("session_event", "18446744073709551615");
  await vi.waitFor(() => expect(f.onEnvelope).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(299_500);
  expect(f.opened).toHaveLength(2);
  expect(f.opened[1].url).toContain("after_sequence_id=18446744073709551615");
  expect(f.opened[1].header).toBe("2");
  f.send("session_event", "18446744073709551615", "epoch", 0);
  expect(f.onEnvelope).toHaveBeenCalledOnce();
});

it("requires the replay boundary epoch and refuses late frames after a stop", async () => {
  const f = fixture();
  await vi.waitFor(() => expect(f.opened).toHaveLength(1));
  f.send("replay_boundary", "0");
  f.send("session_event", "1", "other-epoch");
  expect(f.onEnvelope).not.toHaveBeenCalled();
  expect(f.onTransportError).toHaveBeenCalledOnce();
  expect(f.opened[0].stream.closed).toBe(true);
  f.send("session_event", "1");
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.opened).toHaveLength(1);
  expect(f.onEnvelope).not.toHaveBeenCalled();
});

it.each(["before-boundary", "wrong-session"])(
  "refuses %s delivery before invoking the consumer",
  async (kind) => {
    const f = fixture();
    await vi.waitFor(() => expect(f.opened).toHaveLength(1));
    if (kind === "wrong-session") f.send("replay_boundary", "0");
    f.send(
      "session_event",
      "1",
      "epoch",
      0,
      kind === "wrong-session" ? "other-session" : "session",
    );
    expect(f.onEnvelope).not.toHaveBeenCalled();
    expect(f.onTransportError).toHaveBeenCalledOnce();
    expect(f.opened[0].stream.closed).toBe(true);
  },
);

it.each(["", "not a frame"])(
  "stops on undecodable frame %j without fallback parsing",
  async (text) => {
    const f = fixture();
    await vi.waitFor(() => expect(f.opened).toHaveLength(1));
    f.opened[0].stream.emit("session_event", text);
    expect(f.onEnvelope).not.toHaveBeenCalled();
    expect(f.onTransportError).toHaveBeenCalledOnce();
    expect(f.opened[0].stream.closed).toBe(true);
  },
);

it("refuses an invalid cursor and never rounds it into a reconnect request", () => {
  expect(() =>
    exactSessionCursorProtocol.query({ epoch: "epoch", sequence: "18446744073709551616" }),
  ).toThrow();
  expect(
    exactSessionCursorProtocol.compare(
      { epoch: "a", sequence: "0" },
      { epoch: "b", sequence: "0" },
    ),
  ).toBeNull();
  expect(exactSessionCursorProtocol.successor("18446744073709551615")).toBe("18446744073709551616");
});
