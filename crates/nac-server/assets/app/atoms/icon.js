import { html } from "../lib/html.js";
import { iconPaths } from "./icon-paths.js";

const DEFAULT_VIEW_BOX = "0 0 24 24";

// Icon renders an inline SVG from the ArceeFM path registry (viewBox 0 0 24 24).
// `name` is a key of iconPaths (e.g. "add", "close", "search"). An entry may
// also be `{ d, viewBox }` for glyphs drawn in their own coordinate space.
// `color` is an optional CSS color; the path uses currentColor so button/input
// stylesheets can still override the fill via `.btn-* .icon path { fill: ... }`.
export function Icon({ name, size = 20, color, className = "", ...rest }) {
  const style = color ? { color } : undefined;
  const entry = iconPaths[name];
  const path = (typeof entry === "string" ? entry : entry && entry.d) || "";
  const viewBox = (entry && entry.viewBox) || DEFAULT_VIEW_BOX;
  return html`
    <svg
      class=${"icon " + className}
      width=${size}
      height=${size}
      viewBox=${viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style=${style}
      ...${rest}
    >
      <path d=${path} fill="currentColor" />
    </svg>
  `;
}

export { iconPaths };
