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
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { BranchPicker } from "@/app/components/inspector/BranchPicker";
import { ChatInputBox } from "@/app/components/inspector/ChatInputBox";
import { MobileBottomBar } from "@/app/components/inspector/MobileBottomBar";
import { SessionSideBox } from "@/app/components/inspector/SessionSideBox";
import { Transcript } from "@/app/components/inspector/Transcript";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import {
  useRunStateSync,
  useSessionStream,
} from "@/app/hooks/useSessionStream";
import { cn } from "@/app/lib/cn";
import { perfRender } from "@/app/lib/perfDebug";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
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
  useSelectedThread,
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

  perfRender("SessionPage");

  const { data: snapshot = null, error } = useSessionSnapshot(id);
  const { data: entry = null } = useSessionSummary(id);
  const actions = useSessionActions();
  const collapsed = useSidePanelCollapsed();
  const expanded = useSidePanelExpanded();
  const selectedThread = useSelectedThread();
  const selectedWorkset = useSelectedWorkset();
  const selectedFile = useSelectedFile();
  const isMobile = useIsMobile();
  useSessionStream(id);
  useRunStateSync(snapshot?.active_run);
  useAutoSshConnect(id, entry?.summary);

  useEffect(() => {
    if (id) clearAttention(id);
    resetSessionSelection();
  }, [id]);

  if (!id) return <Navigate to={routes.list()} replace />;
  if (!isSessionPanel(panel)) {
    return <Navigate to={routes.session(id, DEFAULT_SESSION_PANEL)} replace />;
  }

  const configError = entry?.summary.model_config_error;
  // The repair notice already explains a broken config, and that is exactly why
  // the snapshot request fails, so only report an unexplained fetch failure.
  const fetchError =
    !configError && !snapshot && error ? errorMessage(error) : null;
  const errorNotice = configError
    ? {
        message: `Configuration needs repair: ${configError}`,
        action: {
          label: "Open settings",
          onClick: () => actions.settings(id),
        },
      }
    : fetchError
      ? { message: fetchError }
      : null;

  const goToPanel = (next: SessionPanel) => navigate(routes.session(id, next));

  const focusPanel = (next: SessionPanel) => {
    revealSidePanel(isMobile);
    goToPanel(next);
  };

  const sideBox = (
    <SessionSideBox
      sessionId={id}
      snapshot={snapshot}
      panel={panel}
      onPanelChange={goToPanel}
    />
  );

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
              "pt-[72px] pb-2 pl-2 pr-6",
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
          isMobile ? "px-2" : collapsed ? "pl-2 pr-2" : "pl-6 pr-2",
        )}
      >
        <div className="flex flex-col flex-1 min-h-0 w-full relative">
          <Transcript
            sessionId={id}
            snapshot={snapshot}
            panel={panel}
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

      {/* Floats where the box's own header sat, so the toggle stays put. */}
      {collapsed && !isMobile ? (
        <div className="fade absolute left-2 top-[77px] z-10">
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
        </div>
      ) : null}

      {isMobile ? (
        <Modal
          open={expanded}
          onClose={toggleSidePanelExpanded}
          // Its own tabs move the route, so a route change must not close it.
          keepOnNavigate
          title={
            <div className="flex items-center gap-2 min-w-0">
              <span className="header-small truncate flex-1">
                {panel === "threads"
                  ? (selectedThread ??
                    snapshot?.threads?.[0]?.name ??
                    SESSION_PANEL_LABEL.threads)
                  : panel === "worksets"
                    ? (selectedWorkset ??
                      snapshot?.worksets.items[0]?.id ??
                      SESSION_PANEL_LABEL.worksets)
                    : panel === "files"
                      ? (selectedFile?.split("/").pop() ??
                        snapshot?.workspace?.changed_files?.[0]?.path
                          .split("/")
                          .pop() ??
                        SESSION_PANEL_LABEL.files)
                      : SESSION_PANEL_LABEL.history}
              </span>
              {snapshot?.workspace?.branch ? (
                <BranchPicker
                  sessionId={id}
                  branch={snapshot.workspace.branch}
                />
              ) : null}
            </div>
          }
          headerActions={
            panel === "history" ? null : (
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
            panel={panel}
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
