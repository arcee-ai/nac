import { useEffect } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { ChatInputBox } from "@/app/components/inspector/ChatInputBox";
import { SessionSideBox } from "@/app/components/inspector/SessionSideBox";
import { Transcript } from "@/app/components/inspector/Transcript";
import { useRunStateSync, useSessionStream } from "@/app/hooks/useSessionStream";
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
  revealSidePanel,
  toggleSidePanelCollapsed,
  useSidePanelLayout,
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
  const { sessionId, panel } = useParams<{ sessionId: string; panel?: string }>();
  const navigate = useNavigate();
  const id = sessionId ?? null;

  const { data: snapshot = null, error } = useSessionSnapshot(id);
  const { data: sessions = [] } = useSessions();
  const actions = useSessionActions();
  const layout = useSidePanelLayout();
  useSessionStream(id);
  useRunStateSync(snapshot?.active_run);

  useEffect(() => {
    if (id) clearAttention(id);
  }, [id]);

  if (!id) return <Navigate to={routes.list()} replace />;
  if (!isSessionPanel(panel)) {
    return <Navigate to={routes.session(id, DEFAULT_SESSION_PANEL)} replace />;
  }

  const entry = sessions.find((item) => item.summary.session_id === id) ?? null;
  const configError = entry?.summary.model_config_error;
  // The repair banner already explains a broken config, and that is exactly why
  // the snapshot request fails, so only report an unexplained fetch failure.
  const fetchError = !configError && !snapshot && error ? errorMessage(error) : null;

  const showSideBox = layout !== "collapsed";
  const showChat = layout !== "expanded";

  const goToPanel = (next: SessionPanel) => navigate(routes.session(id, next));

  const focusPanel = (next: SessionPanel) => {
    revealSidePanel();
    goToPanel(next);
  };

  return (
    <section className="flex h-full min-h-0 bg-elevation-ground">
      {showSideBox ? (
        <div
          className={cn(
            "flex flex-col min-w-0 h-full pt-[72px] pb-2 pl-2",
            showChat ? "flex-1 max-w-[840px] pr-6" : "flex-1 pr-2",
          )}
        >
          {configError ? (
            <div className="pb-2">
              <Banner
                message={`Configuration needs repair: ${configError}`}
                action={{ label: "Open settings", onClick: () => actions.settings(id) }}
              />
            </div>
          ) : null}
          {fetchError ? (
            <div className="pb-2">
              <Banner message={fetchError} />
            </div>
          ) : null}
          <div className="flex-1 min-h-0">
            <SessionSideBox
              sessionId={id}
              snapshot={snapshot}
              panel={panel}
              onPanelChange={goToPanel}
            />
          </div>
        </div>
      ) : null}

      {showChat ? (
        <div
          className={cn(
            "flex flex-col items-center min-w-0 h-full pr-2",
            showSideBox ? "flex-1 pl-6" : "flex-1 pl-2",
          )}
        >
          <div className="relative flex flex-col flex-1 min-h-0 w-full max-w-[840px]">
            {!showSideBox ? (
              <div className="absolute left-0 top-[60px] z-10">
                <Tooltip title="Show panel" position={TooltipPosition.BottomLeft}>
                  <Button
                    size={ButtonSize.Small}
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
            <Transcript snapshot={snapshot} onFocusPanel={focusPanel} />
            <div className="shrink-0 py-2">
              <ChatInputBox sessionId={id} snapshot={snapshot} entry={entry} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
