import { html } from "../lib/html.js";
import { Icon } from "../atoms/icon.js";
import { HorizontalTabsItem } from "../atoms/tabs.js";
import { InspectorHeader } from "./inspector/InspectorHeader.js";
import { MetricsBar } from "./inspector/MetricsBar.js";
import { ChatTab } from "./inspector/ChatTab.js";
import { EventsView } from "./inspector/EventsView.js";
import { useSnapshot } from "../store/sessionsStore.js";
import { useActiveTab, setActiveTab, TABS } from "../store/selectionStore.js";
import { useSessionStream } from "../hooks/useSessionStream.js";

const TAB_META = {
  chat: { label: "Chat", icon: "chat" },
  events: { label: "Events", icon: "activity" },
  threads: { label: "Threads", icon: "flow" },
  worksets: { label: "Worksets", icon: "layers" },
  workspace: { label: "Workspace", icon: "folder" },
};

function EmptyState() {
  return html`<div class="flex-1 grid place-items-center p-8">
    <div class="text-center max-w-sm">
      <div class="mx-auto mb-3 w-12 h-12 grid place-items-center rounded-full bg-elevation-level-1 border border-secondary">
        <${Icon} name="chat" size=${24} color="var(--color-text-basic-muted)" />
      </div>
      <div class="header-small text-basic-primary mb-1">Brak wybranej sesji</div>
      <div class="label-small text-basic-muted">Wybierz sesję z listy albo utwórz nową.</div>
    </div>
  </div>`;
}

function Placeholder({ tab }) {
  return html`<div class="p-6 text-basic-muted label-small">
    Zakładka „${TAB_META[tab] ? TAB_META[tab].label : tab}" — pełna zawartość w kolejnych krokach.
  </div>`;
}

export function Inspector({ id, entry, isDesktop, onRename, onDelete, onSettings, onCancelRun }) {
  const snapshot = useSnapshot(id);
  const activeTab = useActiveTab();
  useSessionStream(id);

  if (!id) return EmptyState();

  return html`<section class="inspector flex flex-col min-h-0 h-full bg-elevation-level-0-5">
    <${InspectorHeader}
      snapshot=${snapshot}
      entry=${entry}
      isDesktop=${isDesktop}
      onRename=${onRename}
      onDelete=${onDelete}
      onSettings=${onSettings}
      onCancelRun=${onCancelRun}
    />
    <nav class="flex gap-1 px-2 border-b border-primary shrink-0 overflow-x-auto">
      ${TABS.map(
        (t) => html`<${HorizontalTabsItem}
          key=${t}
          active=${activeTab === t}
          iconName=${TAB_META[t] && TAB_META[t].icon}
          onClick=${() => setActiveTab(t)}
        >
          ${TAB_META[t] ? TAB_META[t].label : t}
        </${HorizontalTabsItem}>`,
      )}
    </nav>
    <${MetricsBar} snapshot=${snapshot} entry=${entry} />
    <div class="flex-1 min-h-0">
      ${activeTab === "chat"
        ? html`<${ChatTab} id=${id} />`
        : activeTab === "events"
          ? html`<${EventsView} />`
          : html`<div class="h-full overflow-auto"><${Placeholder} tab=${activeTab} /></div>`}
    </div>
  </section>`;
}
