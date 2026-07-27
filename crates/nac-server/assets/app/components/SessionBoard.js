import { React, html } from "../lib/html.js";
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
  reorderSessionsLocal,
  persistReorder,
  togglePin,
  clearAttention,
  useAttention,
} from "../store/sessionsStore.js";
import { useSelectedId, selectSession } from "../store/selectionStore.js";
import { useToast } from "../providers/ToastProvider.js";

const { useState, useRef } = React;

const summaryOf = (entry) => entry.summary || entry;

export function SessionBoard({ onNewSession }) {
  const sessions = useSessions();
  const loading = useSessionsLoading();
  const error = useSessionsError();
  const storeInfo = useStoreInfo();
  const selectedId = useSelectedId();
  const toast = useToast();
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const dragIdRef = useRef(null); // synchronous source of truth (avoids state races)
  const pendingGroup = useRef(null);

  const onSelect = (id) => {
    clearAttention(id);
    selectSession(id);
    loadSnapshot(id);
  };

  const onTogglePin = async (entry) => {
    try {
      await togglePin(entry);
    } catch (err) {
      toast.error(`Failed to update pin: ${err.message}`);
    }
  };

  const pinned = sessions.filter((e) => summaryOf(e).pinned);
  const unpinned = sessions.filter((e) => !summaryOf(e).pinned);

  const drag = {
    enabled: sessions.length > 1,
    onDragStart: (e, id) => {
      dragIdRef.current = id;
      setDragId(id);
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", id);
      } catch (_) {}
    },
    onDragOver: (e, id) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (id !== overId) setOverId(id);
    },
    onDrop: (e, id) => {
      e.preventDefault();
      const from = dragIdRef.current;
      if (from && from !== id) {
        const group = reorderSessionsLocal(from, id);
        if (group !== null) pendingGroup.current = group;
      }
      setOverId(null);
    },
    onDragEnd: async () => {
      dragIdRef.current = null;
      setDragId(null);
      setOverId(null);
      if (pendingGroup.current !== null) {
        const group = pendingGroup.current;
        pendingGroup.current = null;
        try {
          await persistReorder(group);
        } catch (err) {
          toast.error(`Failed to reorder: ${err.message}`);
        }
      }
    },
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

    <div class="flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-2 [&>*]:shrink-0" aria-label="Sessions">
      ${error ? html`<div class="text-micro text-error-primary mb-1">${error}</div>` : null}
      ${!loading && sessions.length === 0 && !error
        ? html`<div class="text-basic-muted label-small px-1 py-6 text-center">No sessions yet. Create your first one.</div>`
        : null}
      ${pinned.length > 0
        ? html`<div class="tag-label text-basic-muted px-1 pt-1">Pinned</div>
            ${pinned.map((entry) => renderCard(entry))}
            ${unpinned.length > 0 ? html`<div class="tag-label text-basic-muted px-1 pt-2">Sessions</div>` : null}`
        : null}
      ${unpinned.map((entry) => renderCard(entry))}
    </div>
  </section>`;

  function renderCard(entry) {
    const id = summaryOf(entry).session_id;
    return html`<${BoardCard}
      key=${id}
      entry=${entry}
      selected=${id === selectedId}
      onSelect=${onSelect}
      onTogglePin=${onTogglePin}
      drag=${{
        enabled: drag.enabled,
        isDragging: dragId === id,
        isOver: overId === id && dragId !== id,
        onDragStart: drag.onDragStart,
        onDragOver: drag.onDragOver,
        onDrop: drag.onDrop,
        onDragEnd: drag.onDragEnd,
      }}
    />`;
  }
}

// Wrapper so each card can subscribe to its own attention flag via a hook
// (hooks can't run inside a .map, but they can inside a child component).
function BoardCard({ entry, selected, onSelect, onTogglePin, drag }) {
  const id = summaryOf(entry).session_id;
  const attention = useAttention(id);
  return html`<${SessionCard}
    entry=${entry}
    selected=${selected}
    attention=${attention}
    onSelect=${onSelect}
    onTogglePin=${onTogglePin}
    drag=${drag}
  />`;
}
