import { useEffect } from "react";
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
import { errorMessage } from "@/app/providers/ToastProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import {
  DEFAULT_SESSION_PANEL,
  isSessionPanel,
  routes,
  type SessionPanel,
} from "@/app/lib/routes";
import { useSessions, useSessionSnapshot } from "@/app/services/queries";
import { clearAttention } from "@/app/store/attentionStore";
import {
  resetSessionSelection,
  revealSidePanel,
  toggleSidePanelCollapsed,
  toggleSidePanelExpanded,
  useSidePanelCollapsed,
  useSidePanelExpanded,
} from "@/app/store/sessionLayoutStore";

function Banner({
  message,
  action,
}: {
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 rounded-[8px] border border-error-muted bg-error-tertiary text-error-primary shrink-0">
      <Icon iconName={IconName.Repair} />
      <div className="flex-grow min-w-0 label-small truncate">{message}</div>
      {action ? (
        <button
          type="button"
          className="label-small underline shrink-0 hover:opacity-80"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

/** Session screen: the Files/Worksets/Threads box beside a permanent chat. */
export default function SessionPage() {
  const { sessionId, panel } = useParams<{
    sessionId: string;
    panel?: string;
  }>();
  const navigate = useNavigate();
  const id = sessionId ?? null;

  const { data: snapshot = null, error } = useSessionSnapshot(id);
  const { data: sessions = [] } = useSessions();
  const actions = useSessionActions();
  const collapsed = useSidePanelCollapsed();
  const expanded = useSidePanelExpanded();
  useSessionStream(id);
  useRunStateSync(snapshot?.active_run);

  useEffect(() => {
    if (id) clearAttention(id);
    resetSessionSelection();
  }, [id]);

  if (!id) return <Navigate to={routes.list()} replace />;
  if (!isSessionPanel(panel)) {
    return <Navigate to={routes.session(id, DEFAULT_SESSION_PANEL)} replace />;
  }

  const entry = sessions.find((item) => item.summary.session_id === id) ?? null;
  const configError = entry?.summary.model_config_error;
  // The repair banner already explains a broken config, and that is exactly why
  // the snapshot request fails, so only report an unexplained fetch failure.
  const fetchError =
    !configError && !snapshot && error ? errorMessage(error) : null;

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
          {configError ? (
            <div className="pb-2">
              <Banner
                message={`Configuration needs repair: ${configError}`}
                action={{
                  label: "Open settings",
                  onClick: () => actions.settings(id),
                }}
              />
            </div>
          ) : null}
          {fetchError ? (
            <div className="pb-2">
              <Banner message={fetchError} />
            </div>
          ) : null}
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
        <div className="flex flex-col flex-1 min-h-0 w-full max-w-[840px]">
          <Transcript snapshot={snapshot} onFocusPanel={focusPanel} />
          <div className="shrink-0 py-2">
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
