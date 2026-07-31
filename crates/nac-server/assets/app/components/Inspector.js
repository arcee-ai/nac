import { html } from "../lib/html.js";
import { Icon } from "../atoms/icon.js";
import { HorizontalTabsItem } from "../atoms/tabs.js";
import { InspectorHeader } from "./inspector/InspectorHeader.js";
import { MetricsBar } from "./inspector/MetricsBar.js";
import { ChatTab } from "./inspector/ChatTab.js";
import { EventsView } from "./inspector/EventsView.js";
import { ThreadsView } from "./inspector/ThreadsView.js";
import { WorksetsView } from "./inspector/WorksetsView.js";
import { WorkspaceView } from "./inspector/WorkspaceView.js";
import { useSnapshot, useSnapshotError } from "../store/sessionsStore.js";
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
      <div class="header-small text-basic-primary mb-1">No session selected</div>
      <div class="label-small text-basic-muted">Pick a session from the list or create a new one.</div>
    </div>
  </div>`;
}

function Placeholder({ tab }) {
  return html`<div class="p-6 text-basic-muted label-small">
    "${TAB_META[tab] ? TAB_META[tab].label : tab}" tab — full content coming in later steps.
  </div>`;
}

function RepairBanner({ message, onSettings }) {
  return html`<div class="flex items-center gap-3 px-4 py-2 border-b border-error-muted bg-error-tertiary text-error-primary shrink-0">
    <${Icon} name="repair" size=${16} />
    <div class="flex-grow min-w-0">
      <div class="label-small">Configuration needs repair</div>
      <div class="text-micro truncate">${message}</div>
    </div>
    <button
      type="button"
      class="label-small underline shrink-0 hover:opacity-80"
      onClick=${onSettings}
    >
      Open settings
    </button>
  </div>`;
}

export function Inspector({ id, entry, onRename, onDelete, onSettings, onCancelRun }) {
  const snapshot = useSnapshot(id);
  const snapshotError = useSnapshotError(id);
  const activeTab = useActiveTab();
  useSessionStream(id);

  if (!id) return EmptyState();

  const configError = entry && entry.summary && entry.summary.model_config_error;
  // The repair banner already explains a broken config, and that is exactly why
  // the snapshot request fails, so only report an unexplained fetch failure.
  const fetchError = !configError && !snapshot && snapshotError;

  return html`<section class="inspector flex flex-col min-h-0 h-full bg-elevation-level-0-5">
    <${InspectorHeader}
      snapshot=${snapshot}
      entry=${entry}
      onRename=${onRename}
      onDelete=${onDelete}
      onSettings=${onSettings}
      onCancelRun=${onCancelRun}
    />
    ${configError ? html`<${RepairBanner} message=${configError} onSettings=${onSettings} />` : null}
    ${fetchError
      ? html`<div
          class="px-4 py-2 border-b border-error-muted bg-error-tertiary text-error-primary label-small shrink-0"
        >
          ${fetchError}
        </div>`
      : null}
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
          : activeTab === "threads"
            ? html`<${ThreadsView} id=${id} />`
            : activeTab === "worksets"
              ? html`<${WorksetsView} id=${id} />`
              : activeTab === "workspace"
                ? html`<${WorkspaceView} id=${id} />`
                : html`<div class="h-full overflow-auto"><${Placeholder} tab=${activeTab} /></div>`}
    </div>
  </section>`;
}
