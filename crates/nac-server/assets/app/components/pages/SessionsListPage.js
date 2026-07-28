import { React, html } from "../../lib/html.js";
import { Icon } from "../../atoms/icon.js";
import {
  Button,
  ButtonSize,
  ButtonVariant,
  ButtonContent,
} from "../../atoms/button.js";
import { Loader, LoaderSize } from "../../atoms/loader.js";
import { BoxSurface } from "../../atoms/box-surface.js";
import { SessionFilters } from "../sessions/SessionFilters.js";
import { SessionCard } from "../sessions/SessionCard.js";
import { useIsDesktop } from "../../hooks/useMediaQuery.js";
import { useToast } from "../../providers/ToastProvider.js";
import { openSession } from "../../store/routeStore.js";
import { useSelectedId } from "../../store/selectionStore.js";
import {
  useSessionsLoading,
  useSessionsError,
  useAttention,
  togglePin,
} from "../../store/sessionsStore.js";
import { useVisibleSessions } from "../../store/sessionFiltersStore.js";

const { useState } = React;

const summaryOf = (entry) => entry.summary || entry;

// Columns are 360px at minimum and stretch to fill the row, so the design's
// 3-up layout falls out naturally at the 1520px reference width and wider
// viewports gain columns instead of empty space.
function CardGrid({ children }) {
  return html`<div
    class="grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]"
  >
    ${children}
  </div>`;
}

// Wrapper component so each card can subscribe to its own attention flag
// (hooks can't run inside a .map, but they can inside a child component).
function GridCard({ entry, selected, ...rest }) {
  const id = summaryOf(entry).session_id;
  const attention = useAttention(id);
  return html`<${SessionCard}
    entry=${entry}
    selected=${selected}
    attention=${attention}
    ...${rest}
  />`;
}

export function SessionsListPage({ onNewSession, onRename, onDelete, onStop }) {
  const sessions = useVisibleSessions();
  const loading = useSessionsLoading();
  const error = useSessionsError();
  const selectedId = useSelectedId();
  const isDesktop = useIsDesktop();
  const toast = useToast();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const onTogglePin = async (entry) => {
    try {
      await togglePin(entry);
    } catch (err) {
      toast.error(`Failed to update pin: ${err.message}`);
    }
  };

  const onCopyId = async (id) => {
    try {
      await navigator.clipboard.writeText(id);
      toast.success("Session id copied");
    } catch (err) {
      toast.error(`Failed to copy id: ${err.message}`);
    }
  };

  const renderCard = (entry) => {
    const id = summaryOf(entry).session_id;
    return html`<${GridCard}
      key=${id}
      entry=${entry}
      selected=${id === selectedId}
      onOpen=${openSession}
      onTogglePin=${onTogglePin}
      onRename=${onRename}
      onDelete=${onDelete}
      onStop=${onStop}
      onCopyId=${onCopyId}
    />`;
  };

  const pinned = sessions.filter((e) => summaryOf(e).pinned);
  const unpinned = sessions.filter((e) => !summaryOf(e).pinned);

  const newButton = html`<${Button}
    variant=${ButtonVariant.Primary}
    size=${ButtonSize.Medium}
    content=${ButtonContent.IconLeft}
    onClick=${onNewSession}
  >
    <${Icon} name="add" size=${16} /> New
  </${Button}>`;

  const rail = html`<${BoxSurface}
    title=${`${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`}
    headerContent=${html`<div class="flex items-center gap-2 shrink-0">
      ${loading ? html`<${Loader} size=${LoaderSize.Micro} />` : null}
      ${newButton}
    </div>`}
    className="h-full"
    bodyClassName="overflow-auto"
  >
    <${SessionFilters} />
  </${BoxSurface}>`;

  return html`<div class="flex h-full min-h-0">
    ${isDesktop
      ? html`<aside class="w-[360px] shrink-0 p-2 min-h-0">${rail}</aside>`
      : null}
    <div class="flex-1 min-h-0 overflow-auto px-4">
      <div class="py-2 flex flex-col gap-6 [&>*]:shrink-0">
        ${!isDesktop
          ? html`<div class="flex flex-col gap-2">
              <div class="flex items-center gap-2">
                <div class="header-md text-basic-primary flex-1 min-w-0">
                  ${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}
                </div>
                <${Button}
                  variant=${ButtonVariant.Secondary}
                  size=${ButtonSize.Medium}
                  content=${ButtonContent.IconRight}
                  onClick=${() => setFiltersOpen((v) => !v)}
                >
                  Filters
                  <${Icon}
                    name="down"
                    size=${16}
                    className=${filtersOpen ? "rotate-180 transition-transform" : "transition-transform"}
                  />
                </${Button}>
                ${newButton}
              </div>
              ${
                filtersOpen
                  ? html`<${BoxSurface}><${SessionFilters} /></${BoxSurface}>`
                  : null
              }
            </div>`
          : null}
        ${error
          ? html`<div class="label-small text-error-primary">${error}</div>`
          : null}
        ${!loading && sessions.length === 0
          ? html`<div class="label-small text-basic-muted text-center py-16">
              No sessions match the current filters.
            </div>`
          : null}
        ${pinned.length > 0
          ? html`<${CardGrid}>${pinned.map(renderCard)}</${CardGrid}>`
          : null}
        ${unpinned.length > 0
          ? html`<${CardGrid}>${unpinned.map(renderCard)}</${CardGrid}>`
          : null}
      </div>
    </div>
  </div>`;
}
