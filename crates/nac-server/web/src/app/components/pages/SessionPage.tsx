import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Modal,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { BranchPicker } from "@/app/components/inspector/BranchPicker";
import { ChatInputBox } from "@/app/components/inspector/ChatInputBox";
import { MobileBottomBar } from "@/app/components/inspector/MobileBottomBar";
import { SessionSideBox } from "@/app/components/inspector/SessionSideBox";
import { SessionIdentity } from "@/app/components/inspector/SessionIdentity";
import { Transcript } from "@/app/components/inspector/Transcript";
import { ProjectSessionTabs } from "@/app/components/projects/ProjectSessionTabs";
import { useIsDesktop, useIsMobile } from "@/app/hooks/useMediaQuery";
import { useRunStateSync, useSessionStream } from "@/app/hooks/useSessionStream";
import { cn } from "@/app/lib/cn";
import { parseStoreTime } from "@/app/lib/format";
import { primarySessions } from "@/app/lib/projects";
import { perfRender } from "@/app/lib/perfDebug";
import { useErrorNotice } from "@/app/hooks/useErrorNotice";
import {
  DEFAULT_SESSION_PANEL,
  isSessionPanel,
  routes,
  SESSION_PANEL_LABEL,
  type SessionPanel,
} from "@/app/lib/routes";
import {
  useSessions,
  useSessionSnapshot,
  useSessionSummary,
  useSshConnect,
  useWorkspaceRevisionChanges,
} from "@/app/services/queries";
import { clearAttention } from "@/app/store/attentionStore";
import {
  resetSessionSelection,
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
        ssh_port?: number;
        ssh_identity_file?: string;
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
  const [heldProjectId, setHeldProjectId] = useState<string | null>(null);

  perfRender("SessionPage");

  const { data: snapshot = null, error, refetch: refetchSnapshot } = useSessionSnapshot(id);
  const { data: entry = null } = useSessionSummary(id);
  const { data: sessionList } = useSessions();
  const allSessions = sessionList ?? [];
  const toNotice = useErrorNotice(id, entry?.summary.backend);
  const collapsed = useSidePanelCollapsed();
  const expanded = useSidePanelExpanded();
  const selectedThread = useSelectedThread();
  const selectedThreadRunning = useSelectedThreadRunning();
  const selectedWorkset = useSelectedWorkset();
  const selectedFile = useSelectedFile();
  const selectedRevision = useSelectedRevision();
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();
  useSessionStream(id);
  useRunStateSync(snapshot?.active_run);
  useAutoSshConnect(id, entry?.summary);
  const behavior = entry?.summary.behavior ?? snapshot?.metadata.behavior ?? "orchestrator";
  const direct = behavior === "direct" || behavior === "direct-with-orchestrator";
  const sessionPanels: readonly SessionPanel[] = snapshot?.lineage
    ? ["files", "history"]
    : direct
      ? ["delegated", "files", "history"]
      : ["threads", "files", "worksets", "history"];
  const requestedPanel = isSessionPanel(panel) ? panel : DEFAULT_SESSION_PANEL;
  const effectivePanel = sessionPanels.includes(requestedPanel) ? requestedPanel : sessionPanels[0];

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

  if (entry) {
    const nextProjectId = entry.summary.project_id ?? null;
    if (heldProjectId !== nextProjectId) {
      setHeldProjectId(nextProjectId);
    }
  }

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
      panel={effectivePanel}
      onPanelChange={goToPanel}
    />
  );

  // If the open id has just left the list, keep the project's tabs until the
  // router lands on a sibling. Hash history applies that navigation on a later
  // tick than the cache update.
  const projectId = (entry ? entry.summary.project_id : heldProjectId) ?? null;
  const projectSessions = projectId
    ? primarySessions(allSessions)
        .filter((session) => session.summary.project_id === projectId)
        .sort((a, b) => parseStoreTime(b.summary.updated_at) - parseStoreTime(a.summary.updated_at))
    : [];

  return (
    <section className="relative flex h-full min-h-0 overflow-hidden bg-elevation-ground">
      {/* A phone has no room for the split: the chat takes the screen and the
          box comes up as the dialog below instead. */}
      {isMobile ? null : (
        <>
          {/* Yields the box's half of the row to the chat as the box slides away. */}
          <div
            className={cn(
              "h-full shrink-0 transition-[width] duration-150 ease-out",
              collapsed ? "w-0" : "w-1/2",
            )}
          />

          {/*
            Pinned to half the section rather than laid out in the row: a box
            that kept its width while the row shrank would reflow its whole tree
            over the animation, so it slides out at full size instead.
          */}
          <div
            className={cn(
              "absolute inset-y-0 left-0 flex flex-col w-1/2 min-w-0",
              "pt-[56px] pb-2 pl-2 pr-2 xl:pr-6",
              "transition-transform duration-150 ease-out",
              collapsed && "-translate-x-full",
            )}
            aria-hidden={collapsed}
            inert={collapsed}
          >
            <div
              className={cn(
                "flex flex-col flex-1 min-h-0 transition-opacity duration-150 ease-out",
                collapsed && "opacity-0",
              )}
            >
              {/* While the dialog is up it owns the panels, so this half stays
                  empty behind the scrim instead of running them twice. */}
              <div className="flex-1 min-h-0">{expanded ? null : sideBox}</div>
            </div>
          </div>
        </>
      )}

      <div
        className={cn(
          "flex flex-col items-center flex-1 min-w-0 h-full",
          "transition-[padding] duration-150 ease-out",
          isMobile ? "px-0" : collapsed ? "pl-2 pr-2" : isDesktop ? "pl-6 pr-2" : "pl-2 pr-2",
        )}
      >
        {/* The phone reaches the same chats through the header's sheet; there
            is no width here for a strip of tabs. The padding clears the fixed
            52px header the shell puts above everything. */}
        {isMobile ? null : (
          <div className="w-full shrink-0 pt-[60px]">
            <ProjectSessionTabs
              projectId={projectId}
              sessions={projectSessions}
              activeSessionId={id}
              summary={entry?.summary ?? null}
              leading={
                collapsed ? (
                  <Tooltip title="Show panel" position={TooltipPosition.BottomRight}>
                    <Button
                      size={ButtonSize.Medium}
                      variant={ButtonVariant.Ghost}
                      content={ButtonContent.Icon}
                      aria-label="Show panel"
                      onClick={toggleSidePanelCollapsed}
                    >
                      <Icon iconName={IconName.OpenSidebar} />
                    </Button>
                  </Tooltip>
                ) : null
              }
            />
          </div>
        )}

        <SessionIdentity
          behavior={entry?.summary.behavior ?? snapshot?.metadata.behavior ?? null}
          lineage={snapshot?.lineage ?? null}
        />

        <div className="flex flex-col flex-1 min-h-0 w-full relative">
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
              isMobile ? "-mx-2" : "pb-2 mx-auto max-w-[840px]",
            )}
          >
            <ChatInputBox sessionId={id} snapshot={snapshot} entry={entry} />
          </div>
        </div>
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
          <MobileBottomBar
            panel={effectivePanel}
            panels={sessionPanels}
            onPanelChange={(next) => {
              // A fresh tab opens on the row it already has, not its list.
              showSidePanelList(false);
              goToPanel(next);
            }}
          />
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
