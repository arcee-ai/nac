import { React, html } from "../../lib/html.js";
import { renderMarkdown } from "../../lib/markdown.js";
import { useSnapshot } from "../../store/sessionsStore.js";

const { useMemo } = React;

function mapMessages(snap) {
  const raw = (snap && snap.messages) || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((m, i) => {
    const role = m.role || "assistant";
    let content = typeof m.content === "string" ? m.content : "";
    if (role === "assistant" && !content && m.tool_calls) {
      const names = (m.tool_calls || []).map((c) => (c.function && c.function.name) || "tool").join(", ");
      content = `_(wywołanie narzędzi: ${names})_`;
    }
    if (role === "tool") content = "```\n" + content + "\n```";
    return { id: `${role}-${i}`, role, content };
  });
}

// Minimal read-only transcript. The live prompt + SSE streaming version lands
// in Step 5; this proves the chat tab within the shell.
export function Transcript({ id }) {
  const snap = useSnapshot(id);
  const messages = useMemo(() => mapMessages(snap), [snap]);

  if (!snap) return html`<div class="p-6 text-basic-muted label-small">Wczytywanie…</div>`;
  if (messages.length === 0)
    return html`<div class="p-6 text-basic-muted label-small">Brak wiadomości w tej sesji.</div>`;

  return html`<div class="flex flex-col gap-3 p-4">
    ${messages.map(
      (m) => html`<div
        key=${m.id}
        class="rounded-xl p-3 bg-elevation-level-1 border border-secondary"
      >
        <div class="tag-label text-basic-muted mb-1">${m.role}</div>
        <div class="markdown paragraph-medium text-basic-secondary">${renderMarkdown(m.content)}</div>
      </div>`,
    )}
  </div>`;
}
