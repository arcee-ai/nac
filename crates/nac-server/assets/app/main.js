import { React, html } from "./lib/html.js";
import { renderMarkdown } from "./lib/markdown.js";
import {
  Icon,
  Button,
  ButtonVariant,
  ButtonSize,
  ButtonContent,
  Badge,
  BadgeColor,
  HorizontalTabsItem,
  Tooltip,
  Loader,
  LoaderSize,
} from "./atoms/index.js";
import { ThemeProvider, useTheme } from "./providers/ThemeProvider.js";
import { ToastProvider, useToast } from "./providers/ToastProvider.js";
import {
  loadStoreInfo,
  loadSessions,
  loadSnapshot,
  startPolling,
  stopPolling,
  useStoreInfo,
  useSessions,
  useSessionsLoading,
  useSessionsError,
  useSnapshot,
} from "./store/sessionsStore.js";
import {
  selectSession,
  setActiveTab,
  useSelectedId,
  useActiveTab,
  TABS,
} from "./store/selectionStore.js";

const { useEffect, useMemo } = React;
const { createRoot } = window.ReactDOM;

const themeIcon = { light: "sun", dark: "moon", system: "desktop" };

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return html`<${Tooltip} title=${`Motyw: ${theme}`} position="bottom-center">
    <${Button} variant=${ButtonVariant.Secondary} content=${ButtonContent.IconLeft} onClick=${toggleTheme}>
      <${Icon} name=${themeIcon[theme] || "desktop"} /> ${theme}
    </${Button}>
  </${Tooltip}>`;
}

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

function SessionCard({ item, selected, onSelect }) {
  const s = item.summary || item;
  const title = s.title || s.last_user_prompt || s.session_id;
  return html`<button
    class=${[
      "fade-up text-left w-full mb-2 rounded-xl p-3 border transition-colors",
      selected
        ? "bg-elevation-level-2 border-accent-primary"
        : "bg-elevation-level-1 border-secondary hover:bg-elevation-level-2",
    ].join(" ")}
    onClick=${() => onSelect(s.session_id)}
  >
    <div class="flex items-center justify-between gap-2">
      <div class="label-small text-basic-primary truncate">${title.slice(0, 42)}</div>
      ${item.active
        ? html`<${Badge} text="live" color=${BadgeColor.Green} />`
        : html`<${Badge} text=${s.backend || "—"} color=${BadgeColor.Gray} />`}
    </div>
    <div class="text-micro text-basic-muted mt-1 truncate">
      ${s.model || "—"} · ${s.visible_message_count ?? 0} wiadomości
    </div>
  </button>`;
}

function Transcript({ id }) {
  const snap = useSnapshot(id);
  const messages = useMemo(() => mapMessages(snap), [snap]);
  if (!snap) return html`<div class="p-6 text-basic-muted label-small">Wczytywanie…</div>`;
  if (messages.length === 0)
    return html`<div class="p-6 text-basic-muted label-small">Brak wiadomości w tej sesji.</div>`;
  return html`<div class="flex flex-col gap-3 p-4">
    ${messages.map(
      (m) => html`<div key=${m.id} class="rounded-xl p-3 bg-elevation-level-1 border border-secondary">
        <div class="tag-label text-basic-muted mb-1">${m.role}</div>
        <div class="markdown paragraph-medium text-basic-secondary">${renderMarkdown(m.content)}</div>
      </div>`,
    )}
  </div>`;
}

function Inspector({ id }) {
  const activeTab = useActiveTab();
  const snap = useSnapshot(id);
  if (!id)
    return html`<div class="flex-1 grid place-items-center text-basic-muted label-small">
      Wybierz sesję z listy po lewej.
    </div>`;
  return html`<div class="flex-1 min-h-0 flex flex-col">
    <div class="flex items-center gap-3 px-4 h-14 border-b border-primary">
      <div class="header-small text-basic-primary truncate flex-grow">
        ${(snap && (snap.title || snap.session_id)) || id}
      </div>
      ${snap ? html`<${Badge} text=${snap.model || "—"} color=${BadgeColor.Blue} />` : null}
    </div>
    <div class="flex gap-1 px-2 border-b border-primary">
      ${TABS.map(
        (t) => html`<${HorizontalTabsItem} key=${t} active=${activeTab === t} onClick=${() => setActiveTab(t)}>
          ${t}
        </${HorizontalTabsItem}>`,
      )}
    </div>
    <div class="flex-1 min-h-0 overflow-auto">
      ${activeTab === "chat"
        ? html`<${Transcript} id=${id} />`
        : html`<div class="p-6 text-basic-muted label-small">Zakładka „${activeTab}" — w kolejnych krokach.</div>`}
    </div>
  </div>`;
}

function Board() {
  const sessions = useSessions();
  const loading = useSessionsLoading();
  const error = useSessionsError();
  const selectedId = useSelectedId();

  const onSelect = (id) => {
    selectSession(id);
    loadSnapshot(id);
  };

  return html`<aside class="w-[340px] shrink-0 border-r border-primary flex flex-col min-h-0 bg-elevation-ground">
    <div class="flex items-center justify-between px-3 h-14 border-b border-primary">
      <div class="tag-label text-basic-muted">Sesje ${sessions.length ? `(${sessions.length})` : ""}</div>
      ${loading ? html`<${Loader} size=${LoaderSize.Small} />` : null}
    </div>
    <div class="flex-1 min-h-0 overflow-auto p-3">
      ${error ? html`<div class="text-micro text-error-primary mb-2">${error}</div>` : null}
      ${!loading && sessions.length === 0 && !error
        ? html`<div class="text-basic-muted label-small">Brak sesji.</div>`
        : null}
      ${sessions.map(
        (item) => html`<${SessionCard}
          key=${(item.summary || item).session_id}
          item=${item}
          selected=${(item.summary || item).session_id === selectedId}
          onSelect=${onSelect}
        />`,
      )}
    </div>
  </aside>`;
}

function App() {
  const storeInfo = useStoreInfo();
  const toast = useToast();
  const selectedId = useSelectedId();

  useEffect(() => {
    loadStoreInfo();
    loadSessions();
    startPolling(5000);
    return () => stopPolling();
  }, []);

  return html`<div class="h-screen flex flex-col">
    <header class="flex items-center justify-between px-4 h-14 border-b border-primary bg-elevation-ground">
      <div>
        <div class="header-small text-basic-primary">nac · Step 3 — providery + store</div>
        <div class="text-micro text-basic-muted">
          ${storeInfo ? html`store: <span class="text-basic-tertiary">${storeInfo.store_path}</span>` : "łączenie z API…"}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <${Button} variant=${ButtonVariant.Ghost} size=${ButtonSize.Small} onClick=${() => toast.success("Zapisano")}>Toast ✓</${Button}>
        <${Button} variant=${ButtonVariant.GhostDestructive} size=${ButtonSize.Small} onClick=${() => toast.error("Błąd operacji")}>Toast ✕</${Button}>
        <${ThemeToggle} />
      </div>
    </header>
    <main class="flex-1 min-h-0 flex">
      <${Board} />
      <${Inspector} id=${selectedId} />
    </main>
  </div>`;
}

function Root() {
  return html`<${ThemeProvider}><${ToastProvider}><${App} /></${ToastProvider}></${ThemeProvider}>`;
}

createRoot(document.getElementById("root")).render(html`<${Root} />`);
