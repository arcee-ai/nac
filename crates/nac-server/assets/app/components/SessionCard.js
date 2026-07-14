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

export function SessionCard({ entry, snapshot, selected, onSelect }) {
  const s = entry.summary || entry;
  const id = s.session_id;
  const activeRun = (snapshot && snapshot.active_run) || entry.active_run;
  const active = isActiveRun(activeRun);
  const runtime = useRuntime(active, activeRun && activeRun.started_at_epoch_ms);
  const diff = diffTotals(entry, snapshot);
  const preview = displaySessionTitle(s);

  return html`<button
    type="button"
    aria-pressed=${selected}
    onClick=${() => onSelect(id)}
    class=${cn(
      "session-card fade-up text-left w-full rounded-xl p-3 border transition-colors",
      selected
        ? "bg-elevation-level-2 border-accent-primary"
        : "bg-elevation-level-1 border-secondary hover:bg-elevation-level-2",
    )}
  >
    <div class="flex items-center gap-2 mb-1">
      <div class="label-small text-basic-primary truncate flex-grow">${preview}</div>
      ${active
        ? html`<${Badge} text=${runtime || "live"} color=${BadgeColor.Green} />`
        : null}
      ${s.sandboxed ? html`<${Badge} text="sandbox" color=${BadgeColor.Yellow} />` : null}
      ${s.ssh_host ? html`<${Badge} text="ssh" color=${BadgeColor.Blue} />` : null}
    </div>
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
  </button>`;
}
