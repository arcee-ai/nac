import { html } from "../../lib/html.js";
import { cn } from "../../lib/cn.js";
import { metricsFromSnapshot } from "../../lib/format.js";

function Cell({ label, value, accent }) {
  return html`<div class="flex flex-col gap-0.5 min-w-0">
    <span class="tag-label text-basic-muted">${label}</span>
    <strong class=${cn("label-small truncate", accent ? "text-accent-primary" : "text-basic-primary")}>${value}</strong>
  </div>`;
}

export function MetricsBar({ snapshot, entry }) {
  const m = metricsFromSnapshot(snapshot, entry);
  return html`<section class="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-2 px-4 py-3 border-b border-primary shrink-0">
    <${Cell} label="Model" value=${m.model} />
    <${Cell} label="Backend" value=${m.backend} />
    <${Cell} label="Msgs" value=${String(m.messages)} />
    <${Cell} label="Run" value=${m.run} accent=${m.active} />
    <${Cell} label="Tokens" value=${m.tokens} />
    <${Cell} label="Orch Context" value=${m.context} />
  </section>`;
}
