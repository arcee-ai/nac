import type { AssistantStreamDelta, LaggedEvent, ReplayBoundaryEvent, ReplayGapEvent, SessionEventBoundary, SessionEventEnvelope } from "./types.js";
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
    query: (cursor: Cursor) => {
        after_epoch_id: string;
        after_sequence_id: string;
    };
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
export declare const exactSessionCursorProtocol: SessionCursorProtocol<ExactSessionCursor, string>;
export declare const nativeSessionStreamWire: Readonly<SessionStreamWire<NativeSessionStreamFrames>>;
