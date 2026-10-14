import { publicNativeInteger } from "./publicNativeInteger.js";
export const exactSessionCursorProtocol = Object.freeze({
    epoch: (cursor) => cursor.epoch,
    sequence: (cursor) => cursor.sequence,
    compare: (left, right) => {
        const a = publicNativeInteger(left.sequence);
        const b = publicNativeInteger(right.sequence);
        return left.epoch !== right.epoch ? null : a < b ? -1 : a > b ? 1 : 0;
    },
    // This is an expected-sequence diagnostic, not an admitted next cursor.
    successor: (sequence) => (publicNativeInteger(sequence) + 1n).toString(),
    query: (cursor) => {
        publicNativeInteger(cursor.sequence);
        return { after_epoch_id: cursor.epoch, after_sequence_id: cursor.sequence };
    },
});
// The existing raw native decoder stays the sole default parser. Public callers
// supply their maintained schema/text codecs through the explicit wire port.
const nativeJson = (text) => JSON.parse(text);
export const nativeSessionStreamWire = Object.freeze({
    streamPath: (id) => `/sessions/${encodeURIComponent(id)}/events/stream`,
    decodeEnvelope: (nativeJson),
    decodeAssistantDelta: (nativeJson),
    decodeReplayBoundary: (nativeJson),
    decodeReplayGap: (nativeJson),
    decodeLagged: (nativeJson),
    cursorFromEnvelope: (frame) => ({ epoch_id: frame.epoch_id, sequence_id: frame.sequence_id }),
    cursorFromBoundary: (frame) => ({
        epoch_id: frame.epoch_id,
        sequence_id: frame.replay_boundary_sequence_id,
    }),
    cursor: Object.freeze({
        epoch: (cursor) => cursor.epoch_id,
        sequence: (cursor) => cursor.sequence_id,
        compare: (left, right) => left.epoch_id !== right.epoch_id ? null : left.sequence_id - right.sequence_id,
        successor: (sequence) => sequence + 1,
        query: (cursor) => ({
            after_epoch_id: cursor.epoch_id,
            after_sequence_id: String(cursor.sequence_id),
        }),
    }),
    invalidFrame: "ignore",
    epochPolicy: "envelope",
});
