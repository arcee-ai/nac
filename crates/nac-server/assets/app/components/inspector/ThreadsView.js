import { React, html } from "../../lib/html.js";
import { cn } from "../../lib/cn.js";
import { renderMarkdown } from "../../lib/markdown.js";
import { Badge, BadgeColor } from "../../atoms/badge.js";
import { Icon } from "../../atoms/icon.js";
import { Loader, LoaderSize } from "../../atoms/loader.js";
import { useSnapshot } from "../../store/sessionsStore.js";
import { useLiveThreads } from "../../store/runtimeStore.js";

const { useMemo, useState } = React;

function Episode({ episode }) {
  const nodes = useMemo(() => renderMarkdown(episode.content || ""), [episode.content]);
  return html`<div class="rounded-lg border border-secondary bg-elevation-level-0-5 p-3">
    <div class="flex items-center justify-between gap-2 mb-1">
      <span class="label-small text-basic-primary truncate">${episode.action || "(action)"}</span>
      <span class="text-micro text-basic-muted font-mono shrink-0">#${episode.id} · ${episode.created_at}</span>
    </div>
    <div class="markdown paragraph-medium text-basic-secondary">${nodes}</div>
  </div>`;
}

function ThreadRow({ thread, episodes, live, running }) {
  const [open, setOpen] = useState(false);
  const eps = episodes || [];
  // Current operation prefers the live SSE action, then the persisted one.
  const currentOp = (live && (live.lastLine || live.action)) || thread.latest_action || "";
  const hasExit = live && live.exitCode != null;
  return html`<div class=${cn("rounded-xl border bg-elevation-level-1", running ? "border-success-muted" : "border-secondary")}>
    <button
      type="button"
      class="w-full flex items-center gap-2 p-3 text-left"
      onClick=${() => setOpen((v) => !v)}
    >
      <${Icon} name="down" className=${cn("transition-transform", open ? "rotate-0" : "-rotate-90")} />
      <span class="label-small text-basic-primary truncate flex-grow">${thread.name}</span>
      ${running ? html`<${Loader} size=${LoaderSize.Small} />` : null}
      ${running ? html`<${Badge} text="running" color=${BadgeColor.Green} />` : null}
      ${hasExit
        ? html`<${Badge} text=${`exit ${live.exitCode}`} color=${live.isError ? BadgeColor.Red : BadgeColor.Gray} />`
        : null}
      <${Badge} text=${`${thread.episode_count} ep`} color=${BadgeColor.Gray} />
    </button>
    ${currentOp && !open
      ? html`<div class="px-3 pb-3 -mt-1 text-micro text-basic-muted truncate font-mono">${currentOp}</div>`
      : null}
    ${open
      ? html`<div class="px-3 pb-3 flex flex-col gap-2">
          ${live && live.lastLine
            ? html`<div class="text-micro text-basic-muted font-mono">▸ ${live.lastLine}</div>`
            : null}
          ${eps.length === 0
            ? html`<div class="text-basic-muted text-micro">No episodes retained.</div>`
            : eps.map((e) => html`<${Episode} key=${e.id} episode=${e} />`)}
        </div>`
      : null}
  </div>`;
}

// Threads tab: retained workstreams + their episodes, merged with live SSE state
// (running status, current operation, exit code). Running threads are shown first.
export function ThreadsView({ id }) {
  const snap = useSnapshot(id);
  const liveThreads = useLiveThreads();
  const threads = (snap && snap.threads) || [];
  const episodes = (snap && snap.thread_episodes) || {};
  const activeSet = useMemo(() => new Set((snap && snap.active_threads) || []), [snap]);

  const isRunning = (name) => activeSet.has(name) || (liveThreads[name] && liveThreads[name].status === "running");

  const ordered = useMemo(() => {
    const list = threads.slice();
    list.sort((a, b) => Number(isRunning(b.name)) - Number(isRunning(a.name)));
    return list;
    // eslint-disable-next-line
  }, [threads, activeSet, liveThreads]);

  if (!snap) return html`<div class="p-6 text-basic-muted label-small">Loading…</div>`;
  if (threads.length === 0)
    return html`<div class="p-6 text-basic-muted label-small">No threads yet for this session.</div>`;

  const runningCount = ordered.filter((t) => isRunning(t.name)).length;

  return html`<div class="h-full overflow-auto p-4 flex flex-col gap-3">
    ${runningCount > 0
      ? html`<div class="tag-label text-basic-muted">Running (${runningCount})</div>`
      : null}
    ${ordered.map((t, i) => {
      const running = isRunning(t.name);
      const prev = ordered[i - 1];
      const showFinishedHeader = runningCount > 0 && i === runningCount && !running;
      return html`${showFinishedHeader ? html`<div class="tag-label text-basic-muted pt-1">Finished</div>` : null}
        <${ThreadRow}
          key=${t.name}
          thread=${t}
          episodes=${episodes[t.name]}
          live=${liveThreads[t.name]}
          running=${running}
        />`;
    })}
  </div>`;
}
