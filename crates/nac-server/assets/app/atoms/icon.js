import { html } from "../lib/html.js";
import { iconPaths } from "./icon-paths.js";

// Icon renders an inline SVG from the ArceeFM path registry (viewBox 0 0 24 24).
// `name` is a key of iconPaths (e.g. "add", "close", "search").
// `color` is an optional CSS color; the path uses currentColor so button/input
// stylesheets can still override the fill via `.btn-* .icon path { fill: ... }`.
export function Icon({ name, size = 20, color, className = "", ...rest }) {
  const style = color ? { color } : undefined;
  return html`
    <svg
      class=${"icon " + className}
      width=${size}
      height=${size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style=${style}
      ...${rest}
    >
      <path d=${iconPaths[name] || ""} fill="currentColor" />
    </svg>
  `;
}

export { iconPaths };
