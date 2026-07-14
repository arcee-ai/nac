import { html } from "../lib/html.js";
import { Icon } from "../atoms/icon.js";
import { Button, ButtonVariant, ButtonSize, ButtonContent } from "../atoms/button.js";
import { Loader, LoaderSize } from "../atoms/loader.js";
import { Tooltip } from "../atoms/tooltip.js";
import { SessionCard } from "./SessionCard.js";
import {
  useSessions,
  useSessionsLoading,
  useSessionsError,
  useStoreInfo,
  loadSnapshot,
} from "../store/sessionsStore.js";
import { useSelectedId, selectSession } from "../store/selectionStore.js";

export function SessionBoard({ onNewSession }) {
  const sessions = useSessions();
  const loading = useSessionsLoading();
  const error = useSessionsError();
  const storeInfo = useStoreInfo();
  const selectedId = useSelectedId();

  const onSelect = (id) => {
    selectSession(id);
    loadSnapshot(id);
  };

  return html`<section class="board flex flex-col min-h-0 h-full bg-elevation-ground">
    <header class="flex items-center gap-3 px-3 h-14 border-b border-primary shrink-0">
      <div class="font-mono font-bold tracking-[0.18em] text-basic-primary select-none">NAC</div>
      <${Tooltip} title=${storeInfo ? storeInfo.store_path : "store path pending"} position="bottom-left" className="flex-grow min-w-0">
        <div class="text-micro text-basic-muted truncate">
          ${storeInfo ? storeInfo.store_path : "store path pending"}
        </div>
      </${Tooltip}>
      ${loading ? html`<${Loader} size=${LoaderSize.Small} />` : null}
      <${Tooltip} title="New session" position="bottom-right">
        <${Button}
          variant=${ButtonVariant.SecondaryAccent}
          size=${ButtonSize.Small}
          content=${ButtonContent.Icon}
          onClick=${onNewSession}
          aria-label="New session"
        >
          <${Icon} name="add" />
        </${Button}>
      </${Tooltip}>
    </header>

    <div class="flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-2" aria-label="Sessions">
      ${error ? html`<div class="text-micro text-error-primary mb-1">${error}</div>` : null}
      ${!loading && sessions.length === 0 && !error
        ? html`<div class="text-basic-muted label-small px-1 py-6 text-center">No sessions yet. Create your first one.</div>`
        : null}
      ${sessions.map((entry) => {
        const id = (entry.summary || entry).session_id;
        return html`<${SessionCard}
          key=${id}
          entry=${entry}
          selected=${id === selectedId}
          onSelect=${onSelect}
        />`;
      })}
    </div>
  </section>`;
}
