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

// One draw per cell out of eight buckets: 1 empty, 4 outline, 3 filled. Tuning
// these thresholds is the single knob for how dense the pattern looks.
function cellStates(id) {
  const next = xorshift32(hashId(id));
  const states = new Array(CELLS);
  for (let i = 0; i < CELLS; i += 1) {
    const draw = next() % 8;
    states[i] = draw === 0 ? EMPTY : draw < 5 ? OUTLINE : FILLED;
  }
  return states;
}

// Deterministic 6x6 identicon for a session. Strokes are inset by half their
// width so they stay inside the cell (matching a CSS border) and never get
// clipped by the viewBox.
export function SessionAvatar({ id, size = 40, className = "", ...rest }) {
  const color = sessionAvatarColor(id);
  const states = cellStates(id);
  const stroke = GRID / size; // one device pixel expressed in viewBox units
  const inset = stroke / 2;
  const side = 1 - stroke;

  return html`<svg
    class=${cn("block shrink-0", className)}
    width=${size}
    height=${size}
    viewBox=${`0 0 ${GRID} ${GRID}`}
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
            x=${(i % GRID) + inset}
            y=${Math.floor(i / GRID) + inset}
            width=${side}
            height=${side}
            fill=${state === FILLED ? color : "none"}
            stroke=${color}
            stroke-width=${stroke}
          />`,
    )}
  </svg>`;
}
