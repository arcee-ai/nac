import { React, html } from "../lib/html.js";
import { cn } from "../lib/cn.js";
import { Icon } from "../atoms/icon.js";
import { Badge, BadgeColor } from "../atoms/badge.js";
import { displaySessionTitle, shortId, isActiveRun, diffTotals, formatRuntime } from "../lib/format.js";

const { useState, useEffect } = React;

function useRuntime(active, startedAt) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!active) return null;
  return startedAt ? formatRuntime(Date.now() - startedAt) : "00:00:00";
}

export function SessionCard({ entry, snapshot, selected, attention, onSelect, onTogglePin, drag }) {
  const s = entry.summary || entry;
  const id = s.session_id;
  const activeRun = (snapshot && snapshot.active_run) || entry.active_run;
  const active = isActiveRun(activeRun);
  const runtime = useRuntime(active, activeRun && activeRun.started_at_epoch_ms);
  const diff = diffTotals(entry, snapshot);
  const preview = displaySessionTitle(s);
  const lastPrompt = (s.last_user_prompt || "").trim();
  const showPrompt = lastPrompt && lastPrompt !== preview;
  const cwd = typeof s.cwd === "string" ? s.cwd : "";
  const errorish = !!diff.error;
  const d = drag || {};

  const statusColor = active
    ? "bg-success-primary"
    : attention
      ? "bg-danger-primary"
      : "bg-basic-muted";

  const activate = () => onSelect(id);
  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  };

  return html`<div
    class=${cn(
      "session-card fade-up group relative text-left w-full rounded-xl p-3 border transition-colors cursor-pointer",
      d.enabled && "cursor-grab active:cursor-grabbing",
      d.isDragging && "opacity-40",
      d.isOver && "border-accent-primary ring-1 ring-accent-primary",
      selected
        ? "bg-elevation-level-2 border-accent-primary"
        : errorish
          ? "bg-elevation-level-1 border-error-muted hover:bg-elevation-level-2"
          : "bg-elevation-level-1 border-secondary hover:bg-elevation-level-2",
    )}
    role="button"
    tabindex="0"
    aria-pressed=${selected}
    onClick=${activate}
    onKeyDown=${onKeyDown}
    draggable=${d.enabled ? "true" : "false"}
    onDragStart=${d.enabled ? (e) => d.onDragStart(e, id) : undefined}
    onDragOver=${d.enabled ? (e) => d.onDragOver(e, id) : undefined}
    onDrop=${d.enabled ? (e) => d.onDrop(e, id) : undefined}
    onDragEnd=${d.enabled ? d.onDragEnd : undefined}
  >
    <div class="flex items-center gap-2 mb-1">
      <span class=${cn("shrink-0 w-2 h-2 rounded-full", statusColor)} aria-hidden="true"></span>
      <div class="label-small text-basic-primary truncate flex-grow">${preview}</div>
      ${active ? html`<${Badge} text=${runtime || "live"} color=${BadgeColor.Green} />` : null}
      ${s.sandboxed ? html`<${Badge} text="sandbox" color=${BadgeColor.Yellow} />` : null}
      ${s.ssh_host ? html`<${Badge} text="ssh" color=${BadgeColor.Blue} />` : null}
      <button
        type="button"
        class=${cn(
          "session-card-action shrink-0 grid place-items-center w-6 h-6 rounded-md transition-colors",
          s.pinned
            ? "text-accent-primary"
            : "text-basic-muted opacity-0 group-hover:opacity-100 hover:text-basic-primary",
        )}
        aria-label=${s.pinned ? "Unpin session" : "Pin session"}
        title=${s.pinned ? "Unpin" : "Pin"}
        onClick=${(e) => {
          e.stopPropagation();
          onTogglePin && onTogglePin(entry);
        }}
      >
        <${Icon} name="flag" size=${14} />
      </button>
    </div>
    ${showPrompt
      ? html`<div class="text-micro text-basic-tertiary truncate mb-1">${lastPrompt}</div>`
      : null}
    <div class="flex items-center gap-2 text-micro text-basic-muted">
      <span class="font-mono">${shortId(id)}</span>
      <span aria-hidden="true">·</span>
      <span class="truncate">${s.model || "—"}</span>
      <span aria-hidden="true">·</span>
      <span>${s.visible_message_count ?? 0} msg</span>
      ${diff.additions || diff.deletions
        ? html`<span class="ml-auto flex items-center gap-1">
            <span class="text-success-primary">+${diff.additions}</span>
            <span class="text-error-primary">−${diff.deletions}</span>
          </span>`
        : null}
    </div>
    ${cwd
      ? html`<div class="mt-1 text-micro text-basic-muted font-mono truncate">${cwd}</div>`
      : null}
  </div>`;
}
