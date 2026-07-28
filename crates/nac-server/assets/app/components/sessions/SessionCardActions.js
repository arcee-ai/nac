import { html } from "../../lib/html.js";
import { Icon } from "../../atoms/icon.js";
import { Button, ButtonSize, ButtonVariant, ButtonContent } from "../../atoms/button.js";
import { Tooltip } from "../../atoms/tooltip.js";

// `sticky` keeps the box out of the card's clipped overflow; it opens upwards so
// it never covers the button the pointer is on.
function IconAction({ title, icon, onClick, variant = ButtonVariant.Ghost }) {
  return html`<${Tooltip} title=${title} position="top-center" sticky=${true}>
    <${Button}
      variant=${variant}
      size=${ButtonSize.Small}
      content=${ButtonContent.Icon}
      aria-label=${title}
      onClick=${(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <${Icon} name=${icon} size=${16} />
    </${Button}>
  </${Tooltip}>`;
}

// Row of per-card actions. A running session offers "stop" instead of "delete",
// mirroring the design and avoiding a destructive action mid-run.
export function SessionCardActions({ pinned, running, onTogglePin, onRename, onDelete, onStop }) {
  return html`<div class="flex items-center gap-1.5 shrink-0">
    <${IconAction}
      title=${pinned ? "Unpin session" : "Pin session"}
      icon=${pinned ? "unpin" : "pin"}
      onClick=${onTogglePin}
    />
    <${IconAction} title="Rename session" icon="edit" onClick=${onRename} />
    ${running
      ? html`<${IconAction}
          title="Stop run"
          icon="stop"
          variant=${ButtonVariant.GhostDestructive}
          onClick=${onStop}
        />`
      : html`<${IconAction}
          title="Delete session"
          icon="trash"
          variant=${ButtonVariant.GhostDestructive}
          onClick=${onDelete}
        />`}
  </div>`;
}
