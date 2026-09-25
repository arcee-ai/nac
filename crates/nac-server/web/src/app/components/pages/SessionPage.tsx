import { useEffect, useMemo, useRef } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Modal,
} from "@/app/atoms";
import { BranchPicker } from "@/app/components/inspector/BranchPicker";
import { ChatInputBox } from "@/app/components/inspector/ChatInputBox";
import { MobileBottomBar } from "@/app/components/inspector/MobileBottomBar";
import { RightSidebarRail } from "@/app/components/inspector/RightSidebarRail";
import { SessionSideBox } from "@/app/components/inspector/SessionSideBox";
import { Transcript } from "@/app/components/inspector/Transcript";
import { TopSingleSessionHeader } from "@/app/components/inspector/TopSingleSessionHeader";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useRunStateSync, useSessionStream } from "@/app/hooks/useSessionStream";
import { cn } from "@/app/lib/cn";
import { perfRender } from "@/app/lib/perfDebug";
import { sessionPanelPolicy } from "@/app/lib/sessionBehavior";
import type { SessionBehavior } from "@/app/types/api";
import { useErrorNotice } from "@/app/hooks/useErrorNotice";
import {
  DEFAULT_SESSION_PANEL,
  isSessionPanel,
  routes,
  SESSION_PANEL_LABEL,
  type SessionPanel,
} from "@/app/lib/routes";
import {
  useSessionSnapshot,
  useSessionSummary,
  useSshConnect,
  useWorkspaceRevisionChanges,
} from "@/app/services/queries";
import { clearAttention } from "@/app/store/attentionStore";
import {
  bindSidePanelProject,
  resetSessionSelection,
  setSidePanelAnimate,
  revealSidePanel,
  showSidePanelList,
  toggleSidePanelCollapsed,
  toggleSidePanelExpanded,
  toggleSidePanelList,
  useSelectedFile,
  useSelectedRevision,
  useSelectedThread,
  useSelectedThreadRunning,
  useSelectedWorkset,
  useSidePanelAnimate,
  useSidePanelCollapsed,
  useSidePanelExpanded,
} from "@/app/store/sessionLayoutStore";
import {
  markSshConnected,
  markSshDisconnected,
  sshTargetFromSummary,
  sshTargetKey,
  useSshConnectionStatus,
} from "@/app/store/sshConnectionStore";

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
  const target = useMemo(() => sshTargetFromSummary(summary), [summary]);
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
  }, [target, status, connect]);
}

/** Session screen: the Files/Worksets/Threads box beside a permanent chat. */
export default function SessionPage() {
  const { sessionId, panel } = useParams<{
    sessionId: string;
    panel?: string;
  }>();
  const navigate = useNavigate();
  const id = sessionId ?? null;

  perfRender("SessionPage");

  const { data: snapshot = null, error, refetch: refetchSnapshot } = useSessionSnapshot(id);
  const { data: entry = null } = useSessionSummary(id);
  const toNotice = useErrorNotice(id, entry?.summary.backend);
  const collapsed = useSidePanelCollapsed();
  const animateSidePanel = useSidePanelAnimate();
  const expanded = useSidePanelExpanded();
  const selectedThread = useSelectedThread();
  const selectedThreadRunning = useSelectedThreadRunning();
  const selectedWorkset = useSelectedWorkset();
  const selectedFile = useSelectedFile();
  const selectedRevision = useSelectedRevision();
  const isMobile = useIsMobile();
  useSessionStream(id);
  useRunStateSync(snapshot?.active_run);
  useAutoSshConnect(id, entry?.summary);
  // An omitted behavior on a loaded session is the legacy orchestrator. An
  // unloaded session is not that default: painting Threads/Files/Worksets and
  // then replacing them is a flash.
  const behaviorKnown = entry != null || snapshot != null;
  const behavior: SessionBehavior | null = behaviorKnown
    ? (entry?.summary.behavior ?? snapshot?.metadata.behavior ?? "orchestrator")
    : null;
  const panelPolicy =
    behavior == null ? null : sessionPanelPolicy(behavior, snapshot?.lineage?.kind);
  const sessionPanels = panelPolicy?.mobilePanels ?? [];
  const requestedPanel = isSessionPanel(panel) ? panel : DEFAULT_SESSION_PANEL;
  const effectivePanel =
    panelPolicy == null
      ? requestedPanel
      : panelPolicy.mobilePanels.includes(requestedPanel)
        ? requestedPanel
        : panelPolicy.defaultPanel;

  useEffect(() => {
    if (!id || !snapshot || !isSessionPanel(panel) || panel === effectivePanel) return;
    navigate(routes.session(id, effectivePanel), { replace: true });
  }, [effectivePanel, id, navigate, panel, snapshot]);
  // The phone dialog header shows the selected file's +/- badge; a revision
  // reports its own totals rather than the live workspace ones.
  const revisionChanges = useWorkspaceRevisionChanges(
    id,
    isMobile && effectivePanel === "files" ? selectedRevision : null,
  );

  useEffect(() => {
    if (id) clearAttention(id);
    resetSessionSelection();
  }, [id]);

  const projectKey = entry ? (entry.summary.project_id ?? "") : null;
  useEffect(() => {
    if (projectKey == null) return;
    bindSidePanelProject(projectKey);
  }, [projectKey]);

  // Restored after paint, so the launch open has already landed at full width
  // and putting the tween back does not replay it.
  useEffect(() => {
    if (animateSidePanel) return undefined;
    const frame = requestAnimationFrame(() => setSidePanelAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [animateSidePanel]);

  if (!id) return <Navigate to={routes.list()} replace />;
  if (!isSessionPanel(panel)) {
    return <Navigate to={routes.session(id, DEFAULT_SESSION_PANEL)} replace />;
  }

  const configError = entry?.summary.model_config_error;
  // The repair notice already explains a broken config, and that is exactly why
  // the snapshot request fails, so only report an unexplained fetch failure.
  const failure = configError ?? (!snapshot && error ? error : null);
  const errorNotice = failure ? toNotice(failure, () => void refetchSnapshot()) : null;

  const goToPanel = (next: SessionPanel) => navigate(routes.session(id, next));

  const focusPanel = (next: SessionPanel) => {
    revealSidePanel(isMobile);
    goToPanel(next);
  };

  const changedFiles =
    selectedRevision == null
      ? (snapshot?.workspace?.changed_files ?? [])
      : (revisionChanges.data?.changed_files ?? []);
  // Same default as FilesView: with no selection, land on the first change.
  const currentFilePath = selectedFile ?? changedFiles[0]?.path ?? null;
  const currentChangedFile = currentFilePath
    ? changedFiles.find((file) => file.path === currentFilePath)
    : undefined;
  const fileBadge =
    currentChangedFile && (currentChangedFile.additions || currentChangedFile.deletions) ? (
      <div className="flex items-center gap-2 shrink-0 code code-small">
        <span className="text-success-primary">+{currentChangedFile.additions ?? 0}</span>
        <span className="text-error-primary">-{currentChangedFile.deletions ?? 0}</span>
      </div>
    ) : null;

  // ThreadsView syncs the open thread's name and running bit into the store so
  // this header stays aligned with the detail pane (including title shimmer).
  const currentThreadName = selectedThread;
  const threadTitleRunning = effectivePanel === "threads" && selectedThreadRunning;

  const sideBox = (
    <SessionSideBox
      sessionId={id}
      snapshot={snapshot}
      behavior={behavior}
      panel={effectivePanel}
      onPanelChange={goToPanel}
    />
  );

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 h-full overflow-hidden bg-elevation-ground">
      <div className="relative flex flex-1 min-w-0 h-full min-h-0">
        <div
          className={cn(
            "flex flex-col items-center flex-1 min-w-0 h-full",
            isMobile ? "px-0" : "px-2",
          )}
        >
          <div className="flex flex-col flex-1 min-h-0 w-full relative">
            {isMobile && (entry?.lineage ?? snapshot?.lineage) ? (
              <div className="mt-16 flex shrink-0 items-center px-3">
                <Button
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Ghost}
                  onClick={() => {
                    const parentId = (entry?.lineage ?? snapshot?.lineage)?.parent_session_id;
                    if (parentId) navigate(routes.session(parentId, "delegated"));
                  }}
                >
                  Parent chat
                </Button>
              </div>
            ) : null}
            {isMobile ? null : (
              <TopSingleSessionHeader sessionId={id} snapshot={snapshot} entry={entry} />
            )}
            <Transcript
              sessionId={id}
              snapshot={snapshot}
              panel={effectivePanel}
              onFocusPanel={focusPanel}
              errorNotice={errorNotice}
            />

            <div
              className={cn(
                "absolute bottom-0 left-0 right-0",
                // The phone composer paints its own ground fade and owns its
                // padding, so it has to reach past the column's inset.
                isMobile ? "-mx-2" : "pb-2 mx-auto max-w-[720px]",
              )}
            >
              <ChatInputBox sessionId={id} snapshot={snapshot} entry={entry} />
            </div>
          </div>
        </div>

        {isMobile ? null : (
          <>
            {/*
              Same motion as the left sidebar: the column width is what the chat
              lays out against, and the panel slides over the rail that stays.
            */}
            <div
              className={cn(
                "relative h-full shrink-0",
                animateSidePanel && "transition-[width] duration-500 ease-in-out",
                collapsed ? "w-[52px]" : "w-1/2",
              )}
              style={animateSidePanel ? undefined : { transition: "none" }}
            >
              {collapsed ? (
                <div className="absolute inset-y-0 right-0 w-[52px]">
                  <RightSidebarRail
                    sessionId={id}
                    snapshot={snapshot}
                    behavior={behavior}
                    panels={panelPolicy?.widePanels ?? []}
                    onOpen={toggleSidePanelCollapsed}
                    onSelect={focusPanel}
                  />
                </div>
              ) : null}
            </div>
            {/*
            Pinned to the right edge rather than laid out in the row: a box
            that kept its width while the row shrank would reflow its whole tree
            over the animation, so it slides out at full size instead. It fills
            that column edge to edge.
          */}
            <div
              className={cn(
                "absolute inset-y-0 right-0 z-[1] flex flex-col min-w-0 w-1/2",
                animateSidePanel && "transition-transform duration-500 ease-in-out",
                collapsed && "translate-x-full",
              )}
              style={animateSidePanel ? undefined : { transition: "none" }}
              aria-hidden={collapsed}
              inert={collapsed}
            >
              <div className="flex flex-col flex-1 min-h-0">
                {/* While the dialog is up it owns the panels, so this half stays
                  empty behind the scrim instead of running them twice. */}
                <div className="flex-1 min-h-0">{expanded ? null : sideBox}</div>
              </div>
            </div>
          </>
        )}
      </div>

      {isMobile ? (
        <Modal
          open={expanded}
          onClose={toggleSidePanelExpanded}
          // Its own tabs move the route, so a route change must not close it.
          keepOnNavigate
          title={
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex flex-col flex-1 min-w-0 justify-center">
                {/* Truncate on the wrapper — `overflow: hidden` on the same
                    node as `background-clip: text` kills the shimmer. */}
                <div className="min-w-0 truncate">
                  <span
                    className={cn(
                      "header-small",
                      threadTitleRunning ? "text-shimmer-basic" : "text-basic-primary",
                    )}
                  >
                    {effectivePanel === "threads"
                      ? (currentThreadName ?? SESSION_PANEL_LABEL.threads)
                      : effectivePanel === "worksets"
                        ? (selectedWorkset ??
                          snapshot?.worksets.items[0]?.id ??
                          SESSION_PANEL_LABEL.worksets)
                        : effectivePanel === "files"
                          ? (selectedFile?.split("/").pop() ??
                            snapshot?.workspace?.changed_files?.[0]?.path.split("/").pop() ??
                            SESSION_PANEL_LABEL.files)
                          : SESSION_PANEL_LABEL[effectivePanel]}
                  </span>
                </div>
                {effectivePanel === "files" ? fileBadge : null}
              </div>

              {snapshot?.workspace?.branch && !snapshot.lineage ? (
                <BranchPicker sessionId={id} branch={snapshot.workspace.branch} />
              ) : null}
            </div>
          }
          headerActions={
            effectivePanel === "history" ? null : (
              <Button
                size={ButtonSize.Large}
                variant={ButtonVariant.Ghost}
                content={ButtonContent.Icon}
                aria-label="Open list"
                onClick={toggleSidePanelList}
              >
                <Icon iconName={IconName.List} size={24} />
              </Button>
            )
          }
          // Full-bleed body; the bar floats over it the way Figma draws it,
          // so it must not go through the dialog's own footer chrome.
          bodyClassName="!p-0 relative flex flex-col overflow-hidden"
        >
          <div className="flex flex-col flex-1 min-h-0">{sideBox}</div>
          {sessionPanels.length > 0 ? (
            <MobileBottomBar
              panel={effectivePanel}
              panels={sessionPanels}
              onPanelChange={(next) => {
                // A fresh tab opens on the row it already has, not its list.
                showSidePanelList(false);
                goToPanel(next);
              }}
            />
          ) : null}
        </Modal>
      ) : (
        <Modal
          open={expanded}
          onClose={toggleSidePanelExpanded}
          fullScreen
          chromeless
          keepOnNavigate
        >
          <div className="flex flex-col flex-1 min-h-0">{sideBox}</div>
        </Modal>
      )}
    </section>
  );
}
