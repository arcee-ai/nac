import { html } from "../lib/html.js";
import { cn } from "../lib/cn.js";
import { Icon } from "./icon.js";

// px sizes (mirrors ArceeFM LoaderSize enum)
export const LoaderSize = {
  XSmall: 12,
  Micro: 16,
  Small: 20,
  Medium: 24,
  Large: 32,
  XLarge: 48,
};

// Variant -> CSS color for the spinning icon (Icon path uses currentColor).
export const LoaderVariant = {
  Brand: "var(--color-fill-accent-primary)",
  Neutral: "var(--color-fill-basic-primary)",
  Destructive: "var(--color-fill-error-primary)",
};

export function Loader({
  size = LoaderSize.XLarge,
  variant = LoaderVariant.Brand,
  className = "",
  ...rest
}) {
  return html`
    <div class=${cn("flex w-fit h-fit animate-spin loader", className)} ...${rest}>
      <${Icon} name="loader" size=${size} color=${variant} />
    </div>
  `;
}
