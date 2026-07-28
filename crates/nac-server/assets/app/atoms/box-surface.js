import { html } from "../lib/html.js";
import { cn } from "../lib/cn.js";

// Elevated panel with an optional header (title + trailing slot), a scrollable
// body and an optional footer. Mirrors the Figma "BoxSurface" component.
export function BoxSurface({
  title,
  headerContent,
  footer,
  className = "",
  bodyClassName = "",
  children,
}) {
  const showHeader = title != null || headerContent != null;
  return html`<div
    class=${cn(
      "flex flex-col rounded-[8px] overflow-hidden bg-elevation-level-1 shadow-convex",
      className,
    )}
  >
    ${showHeader
      ? html`<div
          class="flex items-center gap-4 h-14 px-4 py-2 border-b border-muted shrink-0"
        >
          <div class="header-md text-basic-primary flex-1 min-w-0 truncate">${title}</div>
          ${headerContent}
        </div>`
      : null}
    <div class=${cn("flex-1 min-h-0 flex flex-col [&>*]:shrink-0", bodyClassName)}>${children}</div>
    ${footer
      ? html`<div class="flex items-center p-4 border-t border-muted shrink-0">${footer}</div>`
      : null}
  </div>`;
}
