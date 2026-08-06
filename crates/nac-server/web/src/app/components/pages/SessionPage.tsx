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
import { ChatInputBox } from "@/app/components/inspector/ChatInputBox";
import { SessionSideBox } from "@/app/components/inspector/SessionSideBox";
import { Transcript } from "@/app/components/inspector/Transcript";
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
  toggleSidePanelCollapsed,
  toggleSidePanelExpanded,
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
    revealSidePanel();
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
      {/* Yields the box's half of the row to the chat as the box slides away. */}
      <div
        className={cn(
          "h-full shrink-0 transition-[width] duration-500 ease-in-out",
          collapsed ? "w-0" : "w-1/2",
        )}
      />

      {/*
        Pinned to half the section rather than laid out in the row: a box that
        kept its width while the row shrank would reflow its whole tree over
        the animation, so it slides out at full size instead.
      */}
      <div
        className={cn(
          "absolute inset-y-0 left-0 flex flex-col w-1/2 min-w-0",
          "pt-[72px] pb-2 pl-2 pr-6",
          "transition-transform duration-500 ease-in-out",
          collapsed && "-translate-x-full",
        )}
        aria-hidden={collapsed}
        inert={collapsed}
      >
        <div
          className={cn(
            "flex flex-col flex-1 min-h-0 transition-opacity duration-300 ease-in-out",
            collapsed && "opacity-0",
          )}
        >
          {/* While the dialog is up it owns the panels, so this half stays
              empty behind the scrim instead of running them twice. */}
          <div className="flex-1 min-h-0">{expanded ? null : sideBox}</div>
        </div>
      </div>

      <div
        className={cn(
          "flex flex-col items-center flex-1 min-w-0 h-full pr-2",
          "transition-[padding] duration-500 ease-in-out",
          collapsed ? "pl-2" : "pl-6",
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

          <div className="mx-auto max-w-[840px] absolute bottom-0 left-0 right-0 pb-2">
            <ChatInputBox sessionId={id} snapshot={snapshot} entry={entry} />
          </div>
        </div>
      </div>

      {/* Floats where the box's own header sat, so the toggle stays put. */}
      {collapsed ? (
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

      <Modal
        open={expanded}
        onClose={toggleSidePanelExpanded}
        fullScreen
        chromeless
      >
        <div className="flex flex-col flex-1 min-h-0">{sideBox}</div>
      </Modal>
    </section>
  );
}
