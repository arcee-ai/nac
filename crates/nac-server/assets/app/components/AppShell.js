import { React, html } from "../lib/html.js";
import { ThemeToggle } from "./ThemeToggle.js";
import { SessionBoard } from "./SessionBoard.js";
import { Splitter } from "./Splitter.js";
import { Inspector } from "./Inspector.js";
import { LaunchModal } from "./modals/LaunchModal.js";
import { RenameModal } from "./modals/RenameModal.js";
import { DeleteModal } from "./modals/DeleteModal.js";
import { SettingsModal } from "./modals/SettingsModal.js";
import { useToast } from "../providers/ToastProvider.js";
import { useIsDesktop } from "../hooks/useMediaQuery.js";
import { api } from "../services/api.js";
import {
  loadStoreInfo,
  loadSessions,
  loadSnapshot,
  startPolling,
  stopPolling,
  useSessions,
} from "../store/sessionsStore.js";
import {
  useSelectedId,
  usePaneRatio,
  useInspectorFullscreen,
  useMobileDetailOpen,
} from "../store/selectionStore.js";

const { useEffect, useRef, useState } = React;

function useSelectedEntry() {
  const sessions = useSessions();
  const id = useSelectedId();
  return sessions.find((e) => (e.summary || e).session_id === id) || null;
}

export function AppShell() {
  const isDesktop = useIsDesktop();
  const selectedId = useSelectedId();
  const entry = useSelectedEntry();
  const paneRatio = usePaneRatio();
  const fullscreen = useInspectorFullscreen();
  const mobileDetailOpen = useMobileDetailOpen();
  const toast = useToast();
  const containerRef = useRef(null);
  const [modal, setModal] = useState(null); // "launch" | "rename" | "delete" | "settings" | null

  useEffect(() => {
    loadStoreInfo();
    loadSessions();
    startPolling(5000);
    return () => stopPolling();
  }, []);

  const closeModal = () => setModal(null);
  const onCancelRun = async () => {
    if (!selectedId) return;
    try {
      await api.cancelActiveRun(selectedId);
      toast.success("Run cancellation requested");
      loadSnapshot(selectedId);
    } catch (e) {
      toast.error(`Failed to stop run: ${e.message}`);
    }
  };

  const inspector = html`<${Inspector}
    id=${selectedId}
    entry=${entry}
    isDesktop=${isDesktop}
    onRename=${() => setModal("rename")}
    onDelete=${() => setModal("delete")}
    onSettings=${() => setModal("settings")}
    onCancelRun=${onCancelRun}
  />`;

  const board = html`<${SessionBoard} onNewSession=${() => setModal("launch")} />`;

  let body;
  if (!isDesktop) {
    // Mobile master/detail: show inspector when a session is opened, else board.
    body = selectedId && mobileDetailOpen ? inspector : board;
  } else if (fullscreen && selectedId) {
    body = inspector;
  } else {
    const cols = `${Math.round(paneRatio * 100)}% auto ${Math.round((1 - paneRatio) * 100)}%`;
    body = html`<div ref=${containerRef} class="grid min-h-0 h-full" style=${{ gridTemplateColumns: cols }}>
      ${board}
      <${Splitter} containerRef=${containerRef} />
      ${inspector}
    </div>`;
  }

  return html`<div class="h-screen flex flex-col">
    <header class="flex items-center justify-between px-3 h-12 border-b border-primary bg-elevation-ground shrink-0">
      <div class="flex items-center gap-2">
        <span class="header-small text-basic-primary">nac</span>
        <span class="tag-label text-basic-muted">sessions</span>
      </div>
      <div class="flex items-center gap-1">
        <${ThemeToggle} />
      </div>
    </header>
    <main class="flex-1 min-h-0">${body}</main>

    <${LaunchModal} open=${modal === "launch"} onClose=${closeModal} />
    <${RenameModal} open=${modal === "rename"} onClose=${closeModal} entry=${entry} />
    <${DeleteModal} open=${modal === "delete"} onClose=${closeModal} entry=${entry} />
    <${SettingsModal} open=${modal === "settings"} onClose=${closeModal} id=${selectedId} />
  </div>`;
}
