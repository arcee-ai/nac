import { React, html } from "../../lib/html.js";
import { cn } from "../../lib/cn.js";
import { renderMarkdown } from "../../lib/markdown.js";
import { useSnapshot } from "../../store/sessionsStore.js";
import { useRunning, useActivity, useRunError } from "../../store/runtimeStore.js";

const { useMemo, useRef, useEffect } = React;

function mapMessages(snap) {
  const raw = (snap && snap.messages) || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((m, i) => {
    const role = m.role || "assistant";
    let content = typeof m.content === "string" ? m.content : "";
    if (role === "assistant" && !content && m.tool_calls) {
      const names = (m.tool_calls || []).map((c) => (c.function && c.function.name) || "tool").join(", ");
      content = `_(tool calls: ${names})_`;
    }
    if (role === "tool") content = "```\n" + content + "\n```";
    return { id: `${role}-${i}`, role, content };
  });
}

const ROLE_STYLE = {
  user: "border-accent-primary bg-elevation-level-1",
  assistant: "border-secondary bg-elevation-level-1",
  system: "border-secondary bg-elevation-level-0-5",
  tool: "border-secondary bg-elevation-level-0-5",
};

function MessageRow({ role, content }) {
  const nodes = useMemo(() => renderMarkdown(content), [content]);
  return html`<div class=${cn("rounded-xl p-3 border", ROLE_STYLE[role] || ROLE_STYLE.assistant)}>
    <div class="tag-label text-basic-muted mb-1">${role}</div>
    <div class="markdown paragraph-medium text-basic-secondary">${nodes}</div>
  </div>`;
}

// Read-only transcript from the canonical snapshot, plus a live typing indicator
// fed by the SSE runtime store. Auto-scrolls to the bottom on new content.
export function Transcript({ id }) {
  const snap = useSnapshot(id);
  const running = useRunning();
  const activity = useActivity();
  const error = useRunError();
  const messages = useMemo(() => mapMessages(snap), [snap]);
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, running, activity]);

  return html`<div ref=${scrollRef} class="flex-1 min-h-0 overflow-auto">
    <div class="flex flex-col gap-3 p-4">
      ${!snap ? html`<div class="text-basic-muted label-small">Loading…</div>` : null}
      ${snap && messages.length === 0 && !running
        ? html`<div class="text-basic-muted label-small">No messages yet. Type something below.</div>`
        : null}
      ${messages.map((m) => html`<${MessageRow} key=${m.id} role=${m.role} content=${m.content} />`)}
      ${running
        ? html`<div class="rounded-xl p-3 border border-secondary bg-elevation-level-1">
            <div class="tag-label text-basic-muted mb-1">assistant</div>
            <div class="flex items-center gap-2 paragraph-medium text-basic-tertiary">
              <span class="text-shimmer-accent">${activity || "Working…"}</span>
              <span class="stream-caret"></span>
            </div>
          </div>`
        : null}
      ${error && !running
        ? html`<div class="rounded-xl p-3 border border-error-primary bg-error-tertiary text-error-primary label-small">
            ${error}
          </div>`
        : null}
    </div>
  </div>`;
}
