import { React, html } from "../../lib/html.js";
import { cn } from "../../lib/cn.js";
import { useLiveEvents, useRunning } from "../../store/runtimeStore.js";

const { useRef, useEffect } = React;

const KIND_COLOR = {
  run: "text-accent-primary",
  tool: "text-basic-secondary",
  thread: "text-info-primary",
  log: "text-basic-muted",
  assistant: "text-basic-primary",
  error: "text-error-primary",
};

// Live event log fed by the SSE stream (event/message-level).
export function EventsView() {
  const events = useLiveEvents();
  const running = useRunning();
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return html`<div class="h-full min-h-0 flex flex-col">
    <div class="flex items-center gap-2 px-4 py-2 border-b border-primary shrink-0">
      <span class="tag-label text-basic-muted">Live events</span>
      <span class=${cn("text-micro", running ? "text-accent-primary" : "text-basic-muted")}>
        ${running ? "● stream active" : "○ idle"}
      </span>
    </div>
    <div ref=${ref} class="flex-1 min-h-0 overflow-auto p-3 font-mono text-micro flex flex-col gap-1">
      ${events.length === 0
        ? html`<div class="text-basic-muted">No events yet. Send a prompt to see the stream.</div>`
        : events.map(
            (e, i) => html`<div key=${i} class=${cn("whitespace-pre-wrap break-words", KIND_COLOR[e.kind] || "text-basic-secondary")}>
              <span class="text-basic-muted">#${e.seq ?? "—"}</span> ${e.text}
            </div>`,
          )}
    </div>
  </div>`;
}
