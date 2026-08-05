import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

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
  Tooltip,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { displaySessionTitle } from "@/app/lib/format";
import { routes } from "@/app/lib/routes";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { useSessions } from "@/app/services/queries";

export function Breadcrumbs() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const actions = useSessionActions();
  const { data: sessions = [] } = useSessions();
  const [open, setOpen] = useState(false);

  const current = sessionId
    ? sessions.find((entry) => entry.summary.session_id === sessionId)?.summary
    : undefined;

  return (
    <nav className="flex items-center min-w-0 gap-1" aria-label="Breadcrumb">
      <Button
        variant={ButtonVariant.Ghost}
        size={ButtonSize.Medium}
        content={ButtonContent.Text}
        onClick={() => navigate(routes.list())}
        aria-current={sessionId ? undefined : "page"}
      >
        All Sessions
      </Button>

      {sessionId ? (
        <>
          <Icon
            iconName={IconName.Right}
            className="text-basic-muted shrink-0"
          />
          <Popover
            open={open}
            onClose={() => setOpen(false)}
            placement={PopoverPlacement.BottomRight}
            size={PopoverSize.Medium}
            className="min-w-0"
            panelClassName="max-h-[420px] overflow-auto"
            content={
              sessions.length === 0 ? (
                <div className="label-small text-basic-muted px-2 py-1">
                  No sessions
                </div>
              ) : (
                sessions.map(({ summary }) => (
                  <button
                    key={summary.session_id}
                    type="button"
                    className={cn(
                      "flex items-center gap-2 min-w-0 px-2 py-1.5 rounded-[4px] text-left hover:bg-btn-ghost-hovered",
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
                      size={20}
                      className="rounded-[2px]"
                    />
                    <span className="label-small text-basic-primary truncate">
                      {displaySessionTitle(summary)}
                    </span>
                  </button>
                ))
              )
            }
          >
            <Button
              variant={ButtonVariant.Ghost}
              size={ButtonSize.Medium}
              content={ButtonContent.Text}
              className="max-w-[320px] px-2"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label="Switch session"
            >
              <SessionAvatar
                id={sessionId}
                size={20}
                className="rounded-[2px]"
              />
              <span className="truncate max-w-[120px]">
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
          </Popover>
          <Tooltip title="New session" position={Tooltip.Position.BottomCenter}>
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
        </>
      ) : null}
    </nav>
  );
}
