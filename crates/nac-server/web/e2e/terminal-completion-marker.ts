import { Buffer } from "node:buffer";

/** Literal source completion is a fact even after later prompt bytes arrive.
 * Keep only a bounded cross-page suffix; never replace SDK reset/ACK handling.
 */
export function completionMarkerObserver(marker: Uint8Array) {
  const needle = Buffer.from(marker);
  if (!needle.length || needle.length > 128) throw new RangeError("Invalid completion marker");
  let tail = Buffer.alloc(0);
  let sawMarker = false;
  return {
    get sawMarker() {
      return sawMarker;
    },
    async reset() {
      // A gap cannot splice partial bytes into a marker. It also cannot undo
      // an actual completion marker already observed on this same source.
      tail = Buffer.alloc(0);
    },
    async write(bytes: Uint8Array) {
      const received = Buffer.concat([tail, Buffer.from(bytes)]);
      sawMarker ||= received.includes(needle);
      tail = Buffer.from(received.subarray(-128));
    },
  };
}
