import { html } from "../lib/html.js";
import { cn } from "../lib/cn.js";

const GRID = 6;
const CELLS = GRID * GRID;

// Cell rendering modes.
const EMPTY = 0;
const OUTLINE = 1;
const FILLED = 2;

// FNV-1a 32-bit. Dependency-free and stable across browsers, so the same
// session id always produces the same avatar.
function hashId(id) {
  const text = String(id || "");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function xorshift32(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    return s;
  };
}

// Hue is derived from the id; saturation and lightness are fixed by the design.
export function sessionAvatarColor(id) {
  return `hsl(${hashId(id) % 360} 75% 50%)`;
}

function neighbours(cell) {
  const col = cell % GRID;
  const row = (cell - col) / GRID;
  const out = [];
  if (row > 0) out.push(cell - GRID);
  if (row < GRID - 1) out.push(cell + GRID);
  if (col > 0) out.push(cell - 1);
  if (col < GRID - 1) out.push(cell + 1);
  return out;
}

// Holes are eroded from the outside in: the frontier starts as the border ring,
// and an inner cell only becomes eligible once one of its neighbours is already
// gone. That keeps every hole connected to the outside, so the avatar reads as
// one solid silhouette with bitten-off edges instead of random speckle.
function emptyCells(next) {
  const empty = new Array(CELLS).fill(false);
  const frontier = [];
  for (let i = 0; i < CELLS; i += 1) {
    const col = i % GRID;
    const row = (i - col) / GRID;
    if (row === 0 || col === 0 || row === GRID - 1 || col === GRID - 1) frontier.push(i);
  }

  const target = 4 + (next() % 5);
  let count = 0;
  while (count < target && frontier.length > 0) {
    // Half the time keep eating next to the previous hole, half the time bite
    // somewhere else on the frontier — a mix of chunks and single nibbles.
    const at = next() % 2 === 0 ? frontier.length - 1 : next() % frontier.length;
    const cell = frontier.splice(at, 1)[0];
    if (empty[cell]) continue;
    empty[cell] = true;
    count += 1;
    for (const n of neighbours(cell)) {
      if (!empty[n] && !frontier.includes(n)) frontier.push(n);
    }
  }
  return empty;
}

// Surviving cells split 4:3 between outline and filled. Tuning that ratio and
// the erosion target above are the two knobs for how the pattern looks.
function cellStates(id) {
  const next = xorshift32(hashId(id));
  const empty = emptyCells(next);
  const states = new Array(CELLS);
  for (let i = 0; i < CELLS; i += 1) {
    if (empty[i]) {
      states[i] = EMPTY;
      continue;
    }
    states[i] = next() % 7 < 4 ? OUTLINE : FILLED;
  }
  return states;
}

// Cell borders scale with the avatar instead of being a fixed pixel count:
// 1.5px at the 40px size used on session cards, proportionally more when the
// avatar is rendered larger. One pixel is the floor, otherwise the 20px avatars
// in the breadcrumbs would land on a blurry sub-pixel stroke.
const CARD_SIZE = 40;
const CARD_STROKE = 1.5;

// Returned in viewBox units; the divisor accounts for the half-stroke padding
// the viewBox carries, so the on-screen width lands exactly on the target.
function strokeWidth(size) {
  const px = Math.max(1, (CARD_STROKE * size) / CARD_SIZE);
  return (px * GRID) / (size - px);
}

// Deterministic 6x6 identicon for a session. Strokes sit centred on the cell
// boundary, matching the Figma component, so neighbouring cells share one line
// rather than stacking two; the viewBox is padded by half a stroke so the outer
// ring is not clipped.
export function SessionAvatar({ id, size = 40, className = "", ...rest }) {
  const color = sessionAvatarColor(id);
  const states = cellStates(id);
  const stroke = strokeWidth(size);
  const half = stroke / 2;

  return html`<svg
    class=${cn("block shrink-0", className)}
    width=${size}
    height=${size}
    viewBox=${`${-half} ${-half} ${GRID + stroke} ${GRID + stroke}`}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    ...${rest}
  >
    ${states.map((state, i) =>
      state === EMPTY
        ? null
        : html`<rect
            key=${i}
            x=${i % GRID}
            y=${Math.floor(i / GRID)}
            width="1"
            height="1"
            fill=${state === FILLED ? color : "none"}
            stroke=${color}
            stroke-width=${stroke}
          />`,
    )}
  </svg>`;
}
