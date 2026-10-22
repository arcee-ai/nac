import { Buffer } from "node:buffer";
import { expect, test } from "vitest";
import { completionMarkerObserver } from "./terminal-completion-marker";

const marker = Buffer.from("GAP-OK");

test("recognizes completion inside a page followed by a long shell prompt", async () => {
  const observed = completionMarkerObserver(marker);
  await observed.write(Buffer.concat([Buffer.from("GAP-OK\r\n"), Buffer.alloc(2048, 112)]));
  expect(observed.sawMarker).toBe(true);
  await observed.write(Buffer.alloc(32768, 112));
  expect(observed.sawMarker).toBe(true);
});

test("recognizes a marker split across pages before truncating the new suffix", async () => {
  const observed = completionMarkerObserver(marker);
  await observed.write(Buffer.from("actual source GAP-"));
  expect(observed.sawMarker).toBe(false);
  await observed.write(Buffer.concat([Buffer.from("OK\r\n"), Buffer.alloc(2048, 112)]));
  expect(observed.sawMarker).toBe(true);
});

test("does not treat the octal input echo or a partial marker as completion", async () => {
  const observed = completionMarkerObserver(marker);
  await observed.write(
    Buffer.from("head -c 12582912 /dev/zero && printf '\\107\\101\\120\\055\\117\\113\\n'"),
  );
  await observed.write(Buffer.alloc(32768));
  await observed.write(Buffer.from("GAP-O"));
  expect(observed.sawMarker).toBe(false);
});

test("reset refuses cross-gap partial markers but preserves an observed source fact", async () => {
  const observed = completionMarkerObserver(marker);
  await observed.write(Buffer.from("GAP-"));
  await observed.reset();
  await observed.write(Buffer.from("OK"));
  expect(observed.sawMarker).toBe(false);
  await observed.write(marker);
  await observed.reset();
  expect(observed.sawMarker).toBe(true);
  expect(completionMarkerObserver(marker).sawMarker).toBe(false);
});
