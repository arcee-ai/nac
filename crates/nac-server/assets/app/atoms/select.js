import { React, html } from "../lib/html.js";
import { cn } from "../lib/cn.js";
import { Icon } from "./icon.js";
import { Button, ButtonSize, ButtonVariant, ButtonContent } from "./button.js";
import { TabButton, TabButtonSize, TabButtonVariant } from "./tabs.js";

const { useState, useRef, useEffect } = React;

// Self-contained dropdown select (replaces ArceeFM Selector + Popover wrapper).
// items: [{ id, label, icon? }]
export function Select({
  items = [],
  value,
  onValueChange,
  size = ButtonSize.Medium,
  variant = ButtonVariant.Secondary,
  placeholder = "Select...",
  disabled = false,
  className = "",
  panelClassName = "",
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = items.find((i) => i.id === value);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const tabSize =
    size === ButtonSize.Small
      ? TabButtonSize.Small
      : size === ButtonSize.Large
        ? TabButtonSize.Large
        : TabButtonSize.Medium;

  const select = (id) => {
    onValueChange && onValueChange(id);
    setOpen(false);
  };

  return html`
    <div class=${cn("relative w-fit", className)} ref=${rootRef}>
      <${Button}
        variant=${variant}
        size=${size}
        disabled=${disabled}
        content=${ButtonContent.IconRight}
        onClick=${() => !disabled && setOpen(!open)}
      >
        ${selected && selected.icon ? html`<${Icon} name=${selected.icon} />` : null}
        <span class="text-left flex-grow truncate">${(selected && selected.label) || placeholder}</span>
        <${Icon}
          name="down"
          className=${cn("transition-transform duration-300 ease-in-out", open ? "rotate-180" : "rotate-0")}
        />
      </${Button}>
      ${open
        ? html`<div
            class=${cn(
              "absolute z-20 mt-1 min-w-full flex flex-col gap-1 p-2 rounded-[8px] fade",
              "bg-elevation-level-2 border border-secondary shadow-xl",
              panelClassName,
            )}
          >
            ${items.map(
              (item) => html`<${TabButton}
                key=${item.id}
                size=${tabSize}
                variant=${item.id === value ? TabButtonVariant.Accent : TabButtonVariant.Regular}
                active=${item.id === value}
                onClick=${() => select(item.id)}
              >
                ${item.icon ? html`<${Icon} name=${item.icon} />` : null}
                <span class="text-left flex-grow">${item.label}</span>
              </${TabButton}>`,
            )}
          </div>`
        : null}
    </div>
  `;
}
