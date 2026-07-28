import { React, html } from "../lib/html.js";
import { TopBar } from "./TopBar.js";
import { SessionsListPage } from "./pages/SessionsListPage.js";
import { SessionDetailPage } from "./pages/SessionDetailPage.js";
import { LaunchModal } from "./modals/LaunchModal.js";
import { RenameModal } from "./modals/RenameModal.js";
import { DeleteModal } from "./modals/DeleteModal.js";
import { SettingsModal } from "./modals/SettingsModal.js";
import { useToast } from "../providers/ToastProvider.js";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts.js";
import { pushLocalEvent } from "../store/runtimeStore.js";
import { api } from "../services/api.js";
import {
  loadStoreInfo,
  loadSessions,
  loadSnapshot,
  startPolling,
  stopPolling,
  useSessions,
} from "../store/sessionsStore.js";
import { useSelectedId } from "../store/selectionStore.js";
import { ROUTE_SESSION, startRouter, useRoute, useRouteSessionId } from "../store/routeStore.js";

const { useEffect, useState } = React;

const summaryOf = (entry) => entry.summary || entry;

export function AppShell() {
  const route = useRoute();
  const routeSessionId = useRouteSessionId();
  const selectedId = useSelectedId();
  const sessions = useSessions();
  const toast = useToast();
  const [modal, setModal] = useState(null); // "launch" | "rename" | "delete" | "settings" | null
  // Card actions target their own session, which is not always the selected one.
  const [actionId, setActionId] = useState(null);

  useEffect(() => {
    loadStoreInfo();
    loadSessions({ workspaceStats: true });
    startPolling(5000, { workspaceStats: true });
    const stopRouter = startRouter();
    return () => {
      stopPolling();
      stopRouter();
    };
  }, []);

  const closeModal = () => setModal(null);
  const entryOf = (id) => sessions.find((e) => summaryOf(e).session_id === id) || null;

  useKeyboardShortcuts({
    sessions,
    selectedId,
    modal,
    closeModal,
    openLaunch: () => setModal("launch"),
  });

  // Handlers are shared between card actions (called with an entry) and the
  // inspector header (called with a click event), so the argument is validated.
  const idOfEntry = (entry) => {
    const s = entry && summaryOf(entry);
    return s && typeof s.session_id === "string" ? s.session_id : null;
  };

  const openModalFor = (name) => (entry) => {
    setActionId(idOfEntry(entry) || routeSessionId);
    setModal(name);
  };

  const cancelRun = async (entry) => {
    const id = idOfEntry(entry) || routeSessionId;
    if (!id) return;
    try {
      await api.cancelActiveRun(id);
      pushLocalEvent("run", "■ run cancellation requested");
      toast.success("Run cancellation requested");
      loadSnapshot(id);
    } catch (e) {
      toast.error(`Failed to stop run: ${e.message}`);
    }
  };

  const onSession = route === ROUTE_SESSION && routeSessionId;
  const modalEntry = entryOf(actionId || routeSessionId);

  return html`<div class="h-screen flex flex-col">
    <${TopBar} />
    <main class="flex-1 min-h-0">
      ${onSession
        ? html`<${SessionDetailPage}
            id=${routeSessionId}
            entry=${entryOf(routeSessionId)}
            onRename=${openModalFor("rename")}
            onDelete=${openModalFor("delete")}
            onSettings=${openModalFor("settings")}
            onCancelRun=${cancelRun}
          />`
        : html`<${SessionsListPage}
            onNewSession=${() => setModal("launch")}
            onRename=${openModalFor("rename")}
            onDelete=${openModalFor("delete")}
            onStop=${cancelRun}
          />`}
    </main>

    <${LaunchModal} open=${modal === "launch"} onClose=${closeModal} />
    <${RenameModal} open=${modal === "rename"} onClose=${closeModal} entry=${modalEntry} />
    <${DeleteModal} open=${modal === "delete"} onClose=${closeModal} entry=${modalEntry} />
    <${SettingsModal}
      open=${modal === "settings"}
      onClose=${closeModal}
      id=${(modalEntry && summaryOf(modalEntry).session_id) || routeSessionId}
    />
  </div>`;
}
