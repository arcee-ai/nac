import { html } from "../../lib/html.js";
import { Icon } from "../../atoms/icon.js";
import { Button, ButtonVariant, ButtonSize, ButtonContent } from "../../atoms/button.js";
import { Tooltip } from "../../atoms/tooltip.js";
import { displaySessionTitle, shortId, isActiveRun } from "../../lib/format.js";

function ActionButton({ title, icon, onClick, variant = ButtonVariant.Ghost, disabled = false }) {
  return html`<${Tooltip} title=${title} position="bottom-center">
    <${Button}
      variant=${variant}
      size=${ButtonSize.Small}
      content=${ButtonContent.Icon}
      onClick=${onClick}
      disabled=${disabled}
      aria-label=${title}
    >
      <${Icon} name=${icon} />
    </${Button}>
  </${Tooltip}>`;
}

export function InspectorHeader({ snapshot, entry, onRename, onDelete, onSettings, onCancelRun }) {
  // Presentation (title/prompt) lives on the list summary; cwd/id/ssh_host also
  // live on the snapshot's `metadata`. Merge with summary taking precedence.
  const s = { ...((snapshot && snapshot.metadata) || {}), ...((entry && entry.summary) || {}) };
  const activeRun = (snapshot && snapshot.active_run) || (entry && entry.active_run);
  const active = isActiveRun(activeRun);
  const title = displaySessionTitle(s);

  return html`<header class="flex items-center gap-3 px-3 h-14 border-b border-primary shrink-0">
    <div class="min-w-0 flex-grow">
      <div class="tag-label text-basic-muted">Inspector</div>
      <div class="header-small text-basic-primary truncate">${title}</div>
      <div class="text-micro text-basic-muted truncate font-mono">
        ${shortId(s.session_id)}${s.ssh_host ? ` · ${s.ssh_host}` : ""}${s.cwd ? ` · ${s.cwd}` : ""}
      </div>
    </div>
    <div class="flex items-center gap-1 shrink-0">
      ${active
        ? html`<${ActionButton}
            title="Stop run"
            icon="stop"
            variant=${ButtonVariant.GhostDestructive}
            onClick=${onCancelRun}
          />`
        : null}
      <${ActionButton} title="Rename" icon="edit" onClick=${onRename} />
      <${ActionButton} title="Session settings" icon="gear" onClick=${onSettings} />
      <${ActionButton} title="Delete session" icon="trash" variant=${ButtonVariant.GhostDestructive} onClick=${onDelete} />
    </div>
  </header>`;
}
