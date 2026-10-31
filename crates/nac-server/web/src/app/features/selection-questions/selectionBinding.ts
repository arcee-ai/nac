/**
 * Binds what a person selected in a rendered reply to the exact range of the
 * stored message text the server validates: Unicode scalar offsets plus the
 * SHA-256 of the complete text. The server re-checks both; this only finds
 * the range the person meant.
 */

/** Must match the server's documented excerpt bound. */
export const MAX_EXCERPT_CHARS = 4_000;
export const MAX_QUESTION_CHARS = 2_000;

export interface SelectionBinding {
  /** Unicode scalar offsets into the stored message text. */
  start: number;
  end: number;
  excerpt: string;
}

// Characters Markdown rendering removes from prose: emphasis, inline code,
// headings, quotes, list bullets, table pipes and link brackets.
const MARKUP = new Set(["*", "_", "`", "~", "#", ">", "|", "-", "+", "[", "]"]);
const isSpace = (char: string) => /\s/u.test(char);

function matchAt(source: string[], selected: string[], from: number): number | null {
  let k = from;
  for (let j = 0; j < selected.length; j += 1) {
    const want = selected[j];
    if (want === " ") {
      while (k < source.length && (isSpace(source[k]) || MARKUP.has(source[k]))) k += 1;
      continue;
    }
    while (k < source.length && source[k] !== want && MARKUP.has(source[k])) k += 1;
    if (source[k] !== want) return null;
    k += 1;
  }
  return k;
}

/**
 * Map rendered selected text onto the stored text. Whitespace runs compare as
 * one space and Markdown markup in the source may be skipped; every other
 * character must match exactly. `hint` (0..1) prefers the occurrence nearest
 * to where the selection sat in the rendered block. Null when the selection
 * does not map, for example across a link target or a rendered formula.
 */
export function bindSelection(
  sourceText: string,
  renderedSelection: string,
  hint = 0,
): SelectionBinding | null {
  const selected = Array.from(renderedSelection.trim().replace(/\s+/gu, " "));
  if (selected.length === 0) return null;
  const source = Array.from(sourceText);
  const target = Math.round(Math.min(Math.max(hint, 0), 1) * source.length);
  let best: SelectionBinding | null = null;
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== selected[0]) continue;
    const end = matchAt(source, selected, start);
    if (end == null) continue;
    if (best == null || Math.abs(start - target) < Math.abs(best.start - target)) {
      best = { start, end, excerpt: source.slice(start, end).join("") };
    }
  }
  return best;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * SHA-256 of the UTF-8 text, as lowercase hex. Pure so it also works where
 * `crypto.subtle` is unavailable (plain-HTTP hosts that are not localhost).
 */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const length = bytes.length;
  const padded = new Uint8Array((((length + 9 + 63) >> 6) << 6) >>> 0);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length << 3) >>> 0);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const t1 =
        (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
}
