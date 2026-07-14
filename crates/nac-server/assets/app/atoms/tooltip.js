import { html } from "../lib/html.js";
import { cn } from "../lib/cn.js";

export const TooltipPosition = {
  TopLeft: "top-left",
  TopCenter: "top-center",
  TopRight: "top-right",
  CenterRight: "center-right",
  BottomRight: "bottom-right",
  BottomCenter: "bottom-center",
  BottomLeft: "bottom-left",
  CenterLeft: "center-left",
};

const positionClasses = {
  "top-right": "top-[-8px] left-0 -translate-y-full",
  "top-center": "top-[-8px] left-1/2 -translate-y-full -translate-x-1/2",
  "top-left": "top-[-8px] right-0 -translate-y-full",
  "center-left": "top-1/2 right-[calc(100%+8px)] -translate-y-1/2",
  "bottom-left": "bottom-[-8px] right-0 translate-y-full",
  "bottom-center": "bottom-[-8px] left-1/2 translate-y-full -translate-x-1/2",
  "bottom-right": "bottom-[-8px] left-0 translate-y-full",
  "center-right": "top-1/2 left-[calc(100%+8px)] -translate-y-1/2",
};

// CSS-hover tooltip (desktop). The sticky/portal + mobile popover variants from
// ArceeFM are out of scope for the base atom; group-hover covers most usage.
export function Tooltip({
  title = "",
  description,
  keyboardShortcuts = [],
  position = TooltipPosition.TopCenter,
  className = "",
  boxClassName = "",
  disabled = false,
  children,
  ...rest
}) {
  if (disabled) return html`<div class=${cn("w-fit h-fit", className)}>${children}</div>`;
  return html`
    <div class=${cn("relative w-fit h-fit group", className)} ...${rest}>
      ${children}
      <div
        class=${cn(
          "tooltip-box absolute text-left w-fit h-fit max-w-[320px] hidden group-hover:flex flex-col gap-1 shadow-xl bg-elevation-ground-inverse p-2 rounded-[4px] z-10 fade",
          positionClasses[position],
          boxClassName,
        )}
      >
        <div class="flex gap-2 items-center">
          <div class="label-micro text-basic-primary-inverse flex-grow">${title}</div>
          ${keyboardShortcuts.length > 0
            ? html`<div class="flex gap-1">
                ${keyboardShortcuts.map(
                  (k, i) => html`<kbd
                    key=${i}
                    class="tag-label px-1 rounded-[3px] bg-sublevel-variant-A text-basic-secondary-inverse"
                    >${k}</kbd
                  >`,
                )}
              </div>`
            : null}
        </div>
        ${description
          ? html`<div class="text-micro text-basic-secondary-inverse w-fit h-fit">
              ${description}
            </div>`
          : null}
      </div>
    </div>
  `;
}
