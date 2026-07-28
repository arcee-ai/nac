import { html } from "../lib/html.js";
import { cn } from "../lib/cn.js";

// Track/knob toggle on the input switcher tokens.
export function Switch({ checked = false, disabled = false, onChange, className = "", ...rest }) {
  return html`<button
    type="button"
    role="switch"
    aria-checked=${checked ? "true" : "false"}
    disabled=${disabled}
    onClick=${() => !disabled && onChange && onChange(!checked)}
    class=${cn(
      "relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200",
      disabled
        ? "bg-input-switcher-disabled cursor-not-allowed"
        : checked
          ? "bg-input-switcher-active cursor-auto"
          : "bg-input-switcher cursor-auto",
      className,
    )}
    ...${rest}
  >
    <span
      class=${cn(
        "absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform duration-200",
        disabled ? "bg-input-knob-disabled" : checked ? "bg-input-knob-active" : "bg-input-knob",
        checked ? "translate-x-4" : "translate-x-0",
      )}
    ></span>
  </button>`;
}
