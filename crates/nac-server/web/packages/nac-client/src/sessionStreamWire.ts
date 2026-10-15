import type {
  AssistantStreamDelta,
  LaggedEvent,
  ReplayBoundaryEvent,
  ReplayGapEvent,
  SessionEventBoundary,
  SessionEventEnvelope,
} from "./types.js";
import { publicNativeInteger } from "./publicNativeInteger.js";

/** Consumer protocol ports; these describe delivery data and convey no authority. */
export interface SessionStreamFrames {
  envelope: unknown;
  assistantDelta: unknown;
  replayBoundary: unknown;
  replayGap: unknown;
  lagged: unknown;
  cursor: unknown;
  sequence: unknown;
}

export interface NativeSessionStreamFrames extends SessionStreamFrames {
  envelope: SessionEventEnvelope;
  assistantDelta: AssistantStreamDelta;
  replayBoundary: ReplayBoundaryEvent;
  replayGap: ReplayGapEvent;
  lagged: LaggedEvent;
  cursor: SessionEventBoundary;
  sequence: number;
}

export interface SessionCursorProtocol<Cursor, Sequence> {
  epoch: (cursor: Cursor) => string;
  sequence: (cursor: Cursor) => Sequence;
  /** null means different epochs, never an ordering across epochs. */
  compare: (left: Cursor, right: Cursor) => number | null;
  successor: (sequence: Sequence) => Sequence;
  query: (cursor: Cursor) => { after_epoch_id: string; after_sequence_id: string };
}

export interface SessionStreamWire<Frames extends SessionStreamFrames> {
  streamPath: (sessionId: string) => string;
  decodeEnvelope: (text: string) => Frames["envelope"];
  decodeAssistantDelta: (text: string) => Frames["assistantDelta"];
  decodeReplayBoundary: (text: string) => Frames["replayBoundary"];
  decodeReplayGap: (text: string) => Frames["replayGap"];
  decodeLagged: (text: string) => Frames["lagged"];
  cursorFromEnvelope: (frame: Frames["envelope"]) => Frames["cursor"];
  cursorFromBoundary: (frame: Frames["replayBoundary"]) => Frames["cursor"];
  cursor: SessionCursorProtocol<Frames["cursor"], Frames["sequence"]>;
  invalidFrame: "ignore" | "stop";
  epochPolicy: "envelope" | "replay-boundary";
}

/** Internal control cursor, deliberately independent of any future public wire DTO. */
export interface ExactSessionCursor {
  epoch: string;
  sequence: string;
}

export const exactSessionCursorProtocol: SessionCursorProtocol<ExactSessionCursor, string> =
  Object.freeze({
    epoch: (cursor: ExactSessionCursor) => cursor.epoch,
    sequence: (cursor: ExactSessionCursor) => cursor.sequence,
    compare: (left: ExactSessionCursor, right: ExactSessionCursor) => {
      const a = publicNativeInteger(left.sequence);
      const b = publicNativeInteger(right.sequence);
      return left.epoch !== right.epoch ? null : a < b ? -1 : a > b ? 1 : 0;
    },
    // This is an expected-sequence diagnostic, not an admitted next cursor.
    successor: (sequence: string) => (publicNativeInteger(sequence) + 1n).toString(),
    query: (cursor: ExactSessionCursor) => {
      publicNativeInteger(cursor.sequence);
      return { after_epoch_id: cursor.epoch, after_sequence_id: cursor.sequence };
    },
  });

// The existing raw native decoder stays the sole default parser. Public callers
// supply their maintained schema/text codecs through the explicit wire port.
const nativeJson = <T>(text: string): T => JSON.parse(text) as T;
export const nativeSessionStreamWire = Object.freeze<SessionStreamWire<NativeSessionStreamFrames>>({
  streamPath: (id) => `/sessions/${encodeURIComponent(id)}/events/stream`,
  decodeEnvelope: nativeJson<SessionEventEnvelope>,
  decodeAssistantDelta: nativeJson<AssistantStreamDelta>,
  decodeReplayBoundary: nativeJson<ReplayBoundaryEvent>,
  decodeReplayGap: nativeJson<ReplayGapEvent>,
  decodeLagged: nativeJson<LaggedEvent>,
  cursorFromEnvelope: (frame) => ({ epoch_id: frame.epoch_id, sequence_id: frame.sequence_id }),
  cursorFromBoundary: (frame) => ({
    epoch_id: frame.epoch_id,
    sequence_id: frame.replay_boundary_sequence_id,
  }),
  cursor: Object.freeze<SessionCursorProtocol<SessionEventBoundary, number>>({
    epoch: (cursor) => cursor.epoch_id,
    sequence: (cursor) => cursor.sequence_id,
    compare: (left, right) =>
      left.epoch_id !== right.epoch_id ? null : left.sequence_id - right.sequence_id,
    successor: (sequence) => sequence + 1,
    query: (cursor) => ({
      after_epoch_id: cursor.epoch_id,
      after_sequence_id: String(cursor.sequence_id),
    }),
  }),
  invalidFrame: "ignore",
  epochPolicy: "envelope",
});
