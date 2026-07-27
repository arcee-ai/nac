import { React, html } from "../../lib/html.js";
import { cn } from "../../lib/cn.js";
import { renderMarkdown } from "../../lib/markdown.js";
import { useSnapshot } from "../../store/sessionsStore.js";
import { useRunning, useActivity, useRunError } from "../../store/runtimeStore.js";
import { displayPromptFromMessageText, formatDurationShort } from "../../lib/format.js";

const { useMemo, useRef, useEffect } = React;

const MAX_MESSAGES = 80;

function mapMessages(snap) {
  const raw = (snap && snap.messages) || [];
  if (!Array.isArray(raw)) return [];
  const durations = (snap && snap.response_timing && snap.response_timing.response_durations_ms) || [];
  let assistantIndex = -1;
  const mapped = raw.map((m, i) => {
    const role = m.role || "assistant";
    let content = typeof m.content === "string" ? m.content : "";
    const rawContent = content;
    if (role === "user") content = displayPromptFromMessageText(content);
    if (role === "assistant" && !content && m.tool_calls) {
      const names = (m.tool_calls || []).map((c) => (c.function && c.function.name) || "tool").join(", ");
      content = `_(tool calls: ${names})_`;
    }
    if (role === "tool") content = "```\n" + content + "\n```";
    let durationMs = null;
    if (role === "assistant") {
      assistantIndex += 1;
      durationMs = durations[assistantIndex] ?? null;
    }
    return { id: `${role}-${i}`, index: i, role, content, rawContent, durationMs };
  });
  // Only keep the most recent messages to stay responsive on long sessions.
  return mapped.length > MAX_MESSAGES ? mapped.slice(-MAX_MESSAGES) : mapped;
}

const ROLE_STYLE = {
  user: "border-accent-primary bg-elevation-level-1",
  assistant: "border-secondary bg-elevation-level-1",
  system: "border-secondary bg-elevation-level-0-5",
  tool: "border-secondary bg-elevation-level-0-5",
};

function MessageRow({ role, content, index, durationMs, pending }) {
  const nodes = useMemo(() => renderMarkdown(content), [content]);
  return html`<div class=${cn("rounded-xl p-3 border", ROLE_STYLE[role] || ROLE_STYLE.assistant)}>
    <div class="flex items-center justify-between gap-2 mb-1">
      <span class="tag-label text-basic-muted">${role}</span>
      <span class="text-micro text-basic-muted font-mono">
        ${pending ? "submitted" : `#${index}`}${durationMs != null ? ` · ${formatDurationShort(durationMs)}` : ""}
      </span>
    </div>
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

  // While a run is in-flight the just-submitted user message may not yet be in
  // the persisted snapshot; surface it from active_run so the chat feels live.
  const submitted = running && snap && snap.active_run && snap.active_run.submitted_user_message;
  const pendingText = submitted ? displayPromptFromMessageText(submitted.content) : "";
  const last = messages[messages.length - 1];
  const showPending =
    pendingText && !(last && last.role === "user" && displayPromptFromMessageText(last.rawContent) === pendingText);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, running, activity, showPending]);

  return html`<div ref=${scrollRef} class="flex-1 min-h-0 overflow-auto">
    <div class="flex flex-col gap-3 p-4">
      ${!snap ? html`<div class="text-basic-muted label-small">Loading…</div>` : null}
      ${snap && messages.length === 0 && !running && !showPending
        ? html`<div class="text-basic-muted label-small">No messages yet. Type something below.</div>`
        : null}
      ${messages.map(
        (m) => html`<${MessageRow}
          key=${m.id}
          role=${m.role}
          content=${m.content}
          index=${m.index}
          durationMs=${m.durationMs}
        />`,
      )}
      ${showPending
        ? html`<${MessageRow} role="user" content=${pendingText} pending=${true} />`
        : null}
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
