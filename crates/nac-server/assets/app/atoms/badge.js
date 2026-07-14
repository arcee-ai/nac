import { html } from "../lib/html.js";
import { cn } from "../lib/cn.js";

export const BadgeColor = {
  Neutral: "bg-sublevel-variant-B text-primary border-muted",
  Green: "bg-success-tertiary text-success-primary border-success-muted",
  Blue: "bg-info-tertiary text-info-primary border-info-muted",
  Red: "bg-error-tertiary text-error-primary border-error-muted",
  Yellow: "bg-danger-tertiary text-danger-primary border-danger-muted",
  Violet: "bg-indigo-400 text-indigo-800 border-indigo-300",
  Gray: "bg-sublevel-variant-A text-basic-secondary border-muted",
};

export function Badge({ text, color = BadgeColor.Neutral, className = "" }) {
  return html`<span
    class=${cn("inline-block tag-label px-[8px] py-[3px] border rounded-full", color, className)}
    >${text}</span
  >`;
}
