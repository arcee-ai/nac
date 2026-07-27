import { React, html } from "../../lib/html.js";
import { cn } from "../../lib/cn.js";
import { Badge, BadgeColor } from "../../atoms/badge.js";
import { Icon } from "../../atoms/icon.js";
import { useSnapshot } from "../../store/sessionsStore.js";

const { useState } = React;

const STATUS_COLOR = {
  done: BadgeColor.Green,
  completed: BadgeColor.Green,
  active: BadgeColor.Blue,
  in_progress: BadgeColor.Blue,
  blocked: BadgeColor.Red,
  failed: BadgeColor.Red,
  planned: BadgeColor.Gray,
  pending: BadgeColor.Gray,
};

const statusColor = (status) => STATUS_COLOR[(status || "").toLowerCase()] || BadgeColor.Neutral;

function Item({ item }) {
  return html`<div class="rounded-lg border border-secondary bg-elevation-level-0-5 p-3">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-micro text-basic-muted font-mono shrink-0">${item.position}</span>
      <span class="label-small text-basic-primary truncate flex-grow">${item.title}</span>
      ${item.role ? html`<${Badge} text=${item.role} color=${BadgeColor.Gray} />` : null}
    </div>
    ${item.scope ? html`<div class="text-micro text-basic-muted mb-1 font-mono truncate">${item.scope}</div>` : null}
    ${item.description ? html`<p class="paragraph-medium text-basic-secondary">${item.description}</p>` : null}
    ${item.acceptance
      ? html`<p class="text-micro text-basic-tertiary mt-1"><span class="text-basic-muted">Acceptance:</span> ${item.acceptance}</p>`
      : null}
    ${item.depends_on && item.depends_on.length
      ? html`<p class="text-micro text-basic-tertiary mt-1"><span class="text-basic-muted">Depends on:</span> ${item.depends_on.join(", ")}</p>`
      : null}
    ${item.notes ? html`<p class="text-micro text-basic-muted mt-1 italic">${item.notes}</p>` : null}
  </div>`;
}

function Workset({ workset }) {
  const [open, setOpen] = useState(true);
  const items = workset.items || [];
  return html`<div class="rounded-xl border border-secondary bg-elevation-level-1">
    <button type="button" class="w-full flex items-center gap-2 p-3 text-left" onClick=${() => setOpen((v) => !v)}>
      <${Icon} name="down" className=${cn("transition-transform", open ? "rotate-0" : "-rotate-90")} />
      <span class="label-small text-basic-primary truncate flex-grow">${workset.goal || workset.id}</span>
      <${Badge} text=${workset.status || "?"} color=${statusColor(workset.status)} />
      <${Badge} text=${`${items.length} items`} color=${BadgeColor.Gray} />
    </button>
    ${open
      ? html`<div class="px-3 pb-3 flex flex-col gap-2">
          <div class="text-micro text-basic-muted font-mono">${workset.id}</div>
          ${workset.summary ? html`<p class="paragraph-medium text-basic-secondary">${workset.summary}</p>` : null}
          ${workset.verification_recipe
            ? html`<div class="rounded-lg border border-secondary bg-elevation-level-0-5 p-2">
                <div class="tag-label text-basic-muted mb-1">Verification recipe</div>
                <pre class="text-micro text-basic-secondary whitespace-pre-wrap font-mono">${workset.verification_recipe}</pre>
              </div>`
            : null}
          ${items.map((it) => html`<${Item} key=${it.position} item=${it} />`)}
        </div>`
      : null}
  </div>`;
}

// Worksets tab: structured plans (goal + items) attached to the session.
export function WorksetsView({ id }) {
  const snap = useSnapshot(id);
  const worksets = (snap && snap.worksets) || {};
  const items = worksets.items || [];

  if (!snap) return html`<div class="p-6 text-basic-muted label-small">Loading…</div>`;
  if (worksets.error)
    return html`<div class="p-6 text-error-primary label-small">${worksets.error}</div>`;
  if (items.length === 0)
    return html`<div class="p-6 text-basic-muted label-small">No worksets defined for this session.</div>`;

  return html`<div class="h-full overflow-auto p-4 flex flex-col gap-3 [&>*]:shrink-0">
    ${items.map((w) => html`<${Workset} key=${w.id} workset=${w} />`)}
  </div>`;
}
