import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { InsightsNavigationProvider } from "@/app/features/insights/InsightsNavigationProvider";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { sessionAvailable } from "@/app/features/ui-policy/policy";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { Activity, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDesktopVisible } from "@/app/features/desktop-commands/visibility";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { Button } from "@/app/atoms";
import { ChatInputBox } from "@/app/components/inspector/ChatInputBox";
import { Transcript } from "@/app/components/inspector/Transcript";
import { TranscriptModelProvider } from "@/app/components/inspector/transcript/TranscriptModelProvider";
import { TopSingleSessionHeader } from "@/app/components/inspector/TopSingleSessionHeader";
import { SessionDrawer } from "@/app/features/session-chrome/SessionDrawer";
import { useRunStateSync, useSessionStream } from "@/app/hooks/useSessionStream";
import { perfRender } from "@/app/lib/perfDebug";
import { sessionPanelPolicy } from "@/app/lib/sessionBehavior";
import type { SessionBehavior } from "@/app/types/api";
import { useErrorNotice } from "@/app/hooks/useErrorNotice";
import { DEFAULT_SESSION_PANEL, isSessionPanel, routes, type SessionPanel } from "@/app/lib/routes";
import { useSessionSnapshot, useSessionSummary, useSshConnect } from "@/app/services/queries";

/**
 * Opens an SSH browse handshake once when landing on a remote session that is
 * not already marked connected. A failed attempt stays disconnected so the
 * chat badge can offer a manual reconnect.
 */
function useAutoSshConnect(
  sessionId: string | null,
  summary:
    | {
        ssh_host: string | null;
        ssh_port?: number | null;
        ssh_identity_file?: string | null;
      }
    | null
    | undefined,
) {
  const {
    useSshConnectionStatus,
    sshTargetKey,
    sshTargetFromSummary,
    markSshDisconnected,
    markSshConnected,
  } = useNativeRuntime().stores.sshConnectionStore;

  const target = useMemo(() => sshTargetFromSummary(summary), [sshTargetFromSummary, summary]);
  const status = useSshConnectionStatus(target);
  const connect = useSshConnect();
  const attemptedKey = useRef<string | null>(null);

  useEffect(() => {
    attemptedKey.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!target) return;
    const key = sshTargetKey(target);
    if (status === "connected") {
      attemptedKey.current = key;
      return;
    }
    if (attemptedKey.current === key || connect.isPending) return;
    attemptedKey.current = key;
    void connect
      .mutateAsync(target)
      .then(() => markSshConnected(target))
      .catch(() => markSshDisconnected(target));
  }, [target, status, connect, sshTargetKey, markSshConnected, markSshDisconnected]);
}

/**
 * Session screen: header, transcript and composer in one column, and nothing
 * else until it has something to say. Panels open as a drawer beside or over
 * the column (`SessionDrawer`), never inside it: the native attention probe
 * reads that column as exactly header, transcript, composer layer.
 */
export default function SessionPage() {
  const desktopVisible = useDesktopVisible();
  const {
    useSidePanelCollapsed,
    useSelectedThread,
    selectInsight,
    revealSidePanel,
    activateSessionSelection,
    unbindSidePanelProject,
    bindSidePanelProject,
  } = useNativeRuntime().stores.sessionLayoutStore;

  const { clearAttention } = useNativeRuntime().stores.attentionStore;

  const { sessionId, panel } = useParams<{
    sessionId: string;
    panel?: string;
  }>();
  const navigate = useNavigate();
  const id = sessionId ?? null;
  const policy = useUiPolicy();
  const projectActions = useProjectActions();

  perfRender("SessionPage");

  const { data: snapshot = null, error, refetch: refetchSnapshot } = useSessionSnapshot(id);
  const { data: entry = null } = useSessionSummary(id);
  const toNotice = useErrorNotice(id, entry?.summary.backend);
  const collapsed = useSidePanelCollapsed();
  const selectedThread = useSelectedThread();

  // An omitted behavior on a loaded session is the legacy orchestrator. An
  // unloaded session is not that default: painting Insights/Files/Worksets and
  // then replacing them is a flash.
  const behaviorKnown = entry != null || snapshot != null;
  const behavior: SessionBehavior | null = behaviorKnown
    ? (entry?.summary.behavior ?? snapshot?.metadata.behavior ?? "orchestrator")
    : null;
  const available =
    !behaviorKnown || sessionAvailable(policy, behavior, entry?.lineage ?? snapshot?.lineage);
  useSessionStream(available ? id : null);
  useRunStateSync(available ? snapshot?.active_run : null);
  useAutoSshConnect(available ? id : null, available ? entry?.summary : null);
  const panelPolicy =
    behavior == null ? null : sessionPanelPolicy(behavior, snapshot?.lineage?.kind);
  const sessionPanels = panelPolicy?.mobilePanels ?? [];
  const requestedPanel = isSessionPanel(panel) ? panel : DEFAULT_SESSION_PANEL;
  // Insights took over the Threads panel; an old link keeps the selected thread.
  const routedPanel = requestedPanel === "threads" ? "insights" : requestedPanel;
  const effectivePanel =
    panelPolicy == null
      ? routedPanel
      : panelPolicy.mobilePanels.includes(routedPanel)
        ? routedPanel
        : panelPolicy.defaultPanel;

  useEffect(() => {
    if (!id || !isSessionPanel(panel)) return;
    // Other corrections wait for the snapshot's panels. An old Threads link moves
    // at once: moving it later would close a dialog opened over the page meanwhile.
    const target = snapshot ? effectivePanel : panel === "threads" ? routedPanel : panel;
    if (target === panel) return;
    if (panel === "threads" && selectedThread) selectInsight({ kind: "thread" });
    navigate(routes.session(id, target), { replace: true });
  }, [effectivePanel, id, navigate, panel, routedPanel, selectInsight, selectedThread, snapshot]);

  const heartbeatResultsThrough =
    entry?.summary.session_id === id
      ? (entry.heartbeat_results ?? []).reduce(
          (maximum, result) => Math.max(maximum, result.sequence),
          0,
        )
      : 0;
  useEffect(() => {
    if (id) clearAttention(id, heartbeatResultsThrough);
  }, [clearAttention, id, heartbeatResultsThrough]);

  useEffect(() => {
    activateSessionSelection(id);
  }, [id, activateSessionSelection]);

  const projectKey = entry ? (entry.summary.project_id ?? "") : null;
  useLayoutEffect(() => {
    unbindSidePanelProject();
    if (projectKey == null) return;
    bindSidePanelProject(projectKey);
  }, [bindSidePanelProject, id, projectKey, unbindSidePanelProject]);

  // The composer floats over the transcript, whose run-out under the last
  // message has to clear it however tall it grows.
  const [chatColumn, setChatColumn] = useState<HTMLDivElement | null>(null);
  const [composerLayer, setComposerLayer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!chatColumn || !composerLayer || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      chatColumn.style.setProperty("--composer-height", `${composerLayer.offsetHeight}px`);
    });
    observer.observe(composerLayer);
    return () => observer.disconnect();
  }, [chatColumn, composerLayer]);

  if (behaviorKnown && !available)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-elevation-ground p-8 text-center">
        <h1 className="type-heading text-basic-primary">
          This chat is unavailable in direct-only mode
        </h1>
        <p className="type-body-chrome max-w-[420px] text-basic-tertiary">
          Its saved behavior and history are preserved. An operator can enable orchestration to open
          it.
        </p>
        <Button
          onClick={() => {
            const projectId = entry?.summary.project_id ?? snapshot?.metadata.project_id;
            if (projectId) void projectActions.newChat(projectId);
            else projectActions.create();
          }}
        >
          New direct chat
        </Button>
      </div>
    );
  if (!id) return <Navigate to={routes.list()} replace />;
  if (!isSessionPanel(panel)) {
    return <Navigate to={routes.session(id, DEFAULT_SESSION_PANEL)} replace />;
  }

  const configError = entry?.summary.model_config_error;
  // The repair notice already explains a broken config, and that is exactly why
  // the snapshot request fails, so only report an unexplained fetch failure.
  const failure = configError ?? (!snapshot && error ? error : null);
  const errorNotice = failure ? toNotice(failure, () => void refetchSnapshot()) : null;

  // The chat (the transcript's "Worked for…" line, a thread card, a snapshot)
  // points the drawer at one of its rows and opens it there.
  const focusPanel = (next: SessionPanel) => {
    revealSidePanel();
    navigate(routes.session(id, next));
  };

  const direct = behavior === "direct" || behavior === "direct-with-orchestrator";
  const lineage = entry?.lineage ?? snapshot?.lineage ?? null;

  const page = (
    <section className="relative flex min-h-0 min-w-0 flex-1 h-full overflow-clip bg-elevation-ground">
      {/* The chat column: exactly header, transcript, composer layer. */}
      <div ref={setChatColumn} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <TopSingleSessionHeader
          sessionId={id}
          snapshot={snapshot}
          entry={entry}
          panel={effectivePanel}
        />
        <Transcript
          sessionId={id}
          snapshot={snapshot}
          // The chat marks the rows the drawer shows, so none while it is closed.
          panel={collapsed ? null : effectivePanel}
          onFocusPanel={focusPanel}
          errorNotice={errorNotice}
        />

        <div ref={setComposerLayer} className="pointer-events-none absolute inset-x-0 bottom-0">
          <ChatInputBox sessionId={id} snapshot={snapshot} entry={entry} />
        </div>
      </div>

      <SessionDrawer
        sessionId={id}
        snapshot={snapshot}
        behavior={behavior}
        panel={effectivePanel}
        goalEnabled={direct && lineage == null}
      />
    </section>
  );

  return (
    <Activity mode={desktopVisible ? "visible" : "hidden"}>
      <TranscriptModelProvider sessionId={id} snapshot={snapshot}>
        <InsightsNavigationProvider sessionId={id} panels={sessionPanels} focusPanel={focusPanel}>
          {page}
        </InsightsNavigationProvider>
      </TranscriptModelProvider>
    </Activity>
  );
}
