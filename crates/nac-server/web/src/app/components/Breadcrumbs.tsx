import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  PopoverSize,
  SessionAvatar,
  TabButton,
  TabButtonSize,
  Tooltip,
} from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { displaySessionTitle, isActiveRun } from "@/app/lib/format";
import { routes, sessionIdFromPath } from "@/app/lib/routes";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { useSessions } from "@/app/services/queries";

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const sessionId = sessionIdFromPath(pathname);
  const navigate = useNavigate();
  const actions = useSessionActions();
  const isMobile = useIsMobile();
  const { data: sessions = [] } = useSessions();
  const [open, setOpen] = useState(false);

  const currentEntry = sessionId
    ? sessions.find((entry) => entry.summary.session_id === sessionId)
    : undefined;
  const current = currentEntry?.summary;
  const currentRunning = isActiveRun(currentEntry?.active_run);

  // A phone has no room for the trail: inside a session only the session shows,
  // and the button that opens it doubles as the way back to the list.
  const showRoot = !isMobile || !sessionId;

  return (
    <nav className="flex items-center min-w-0 gap-1" aria-label="Breadcrumb">
      {showRoot ? (
        isMobile ? (
          // The phone drops the button chrome and steps the label up to 16px.
          // `.btn-medium` would pin it back to 14px, so this cannot be a Button.
          <button
            type="button"
            className="label-medium text-btn-secondary rounded-[8px] truncate"
            onClick={() => navigate(routes.list())}
            aria-current={sessionId ? undefined : "page"}
          >
            All Sessions
          </button>
        ) : (
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Medium}
            content={ButtonContent.Text}
            onClick={() => navigate(routes.list())}
            aria-current={sessionId ? undefined : "page"}
          >
            All Sessions
          </Button>
        )
      ) : null}

      {sessionId ? (
        <>
          {showRoot ? (
            <Icon
              iconName={IconName.Right}
              className="text-basic-muted shrink-0"
            />
          ) : null}
          <Popover
            open={open}
            onClose={() => setOpen(false)}
            placement={PopoverPlacement.BottomRight}
            size={PopoverSize.Medium}
            className="min-w-0"
            panelClassName="max-h-[420px] overflow-auto"
            sheetClassName="px-2"
            content={
              <div
                className={
                  isMobile ? "flex flex-col h-[calc(70dvh)]" : "flex flex-col"
                }
              >
                {/* The trail is gone on a phone, so the way back to the list
                    (and the launch affordance) stay pinned above the switcher. */}
                {isMobile ? (
                  <div className="flex flex-col gap-2 shrink-0 pb-2">
                    <TabButton
                      size={TabButtonSize.Large}
                      onClick={() => {
                        setOpen(false);
                        navigate(routes.list());
                      }}
                    >
                      <Icon iconName={IconName.Left} className="shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-left">
                        All Sessions
                      </span>
                    </TabButton>
                    <TabButton
                      size={TabButtonSize.Large}
                      onClick={() => {
                        setOpen(false);
                        actions.launch();
                      }}
                    >
                      <Icon iconName={IconName.Add} className="shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-left">
                        New Session
                      </span>
                    </TabButton>
                  </div>
                ) : null}
                <div
                  className={cn(
                    "flex flex-col",
                    isMobile &&
                      "flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
                  )}
                >
                  {sessions.length === 0 ? (
                    <div className="label-small text-basic-muted px-2 py-1">
                      No sessions
                    </div>
                  ) : (
                    sessions.map(({ summary, active_run }) => {
                      const running = isActiveRun(active_run);
                      return (
                        <button
                          key={summary.session_id}
                          type="button"
                          className={cn(
                            "flex items-center gap-2 min-w-0 rounded-[4px] text-left hover:bg-btn-ghost-hovered",
                            isMobile ? "h-12 gap-3 px-3" : "px-2 py-1.5",
                            summary.session_id === sessionId &&
                              "bg-btn-ghost-highlighted",
                          )}
                          onClick={() => {
                            setOpen(false);
                            navigate(routes.session(summary.session_id));
                          }}
                        >
                          <SessionAvatar
                            id={summary.session_id}
                            size={isMobile ? 24 : 20}
                            isRunning={running}
                          />
                          <span
                            className={cn(
                              "truncate",
                              isMobile ? "text-medium" : "label-small",
                              running
                                ? "text-shimmer-basic"
                                : "text-basic-primary",
                            )}
                          >
                            {displaySessionTitle(summary)}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            }
          >
            {isMobile ? (
              // The design gives the phone a fixed 128px slot holding just the
              // title and a chevron — no avatar, and 16px text that the button
              // atom's own font size would override.
              <button
                type="button"
                className="flex items-center gap-2 w-[128px] rounded-[8px] text-btn-secondary"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label="Switch session"
              >
                <span
                  className={cn(
                    "label-medium flex-1 min-w-0 truncate text-left",
                    currentRunning && "text-shimmer-basic",
                  )}
                >
                  {displaySessionTitle(current) || sessionId}
                </span>
                <Icon
                  iconName={IconName.Right}
                  size={24}
                  className="shrink-0"
                />
              </button>
            ) : (
              <Button
                variant={ButtonVariant.Ghost}
                size={ButtonSize.Medium}
                content={ButtonContent.Text}
                className="px-2 max-w-[320px]"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label="Switch session"
              >
                <SessionAvatar
                  id={sessionId}
                  size={24}
                  isRunning={currentRunning}
                  className="rounded-[2px]"
                />
                <span
                  className={cn(
                    "truncate max-w-[120px]",
                    currentRunning && "text-shimmer-basic",
                  )}
                >
                  {displaySessionTitle(current) || sessionId}
                </span>
                <Icon
                  iconName={IconName.Down}
                  className={cn(
                    "transition-transform",
                    open ? "rotate-180" : undefined,
                  )}
                />
              </Button>
            )}
          </Popover>
          {/* The phone header is already at its limit, and the list one tap
              away carries the same button. */}
          {isMobile ? null : (
            <Tooltip
              title="New session"
              position={Tooltip.Position.BottomCenter}
            >
              <Button
                variant={ButtonVariant.Primary}
                size={ButtonSize.Small}
                content={ButtonContent.Icon}
                aria-label="New session"
                onClick={actions.launch}
              >
                <Icon iconName={IconName.Add} />
              </Button>
            </Tooltip>
          )}
        </>
      ) : null}
    </nav>
  );
}
