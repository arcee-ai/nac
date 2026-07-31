import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  SessionAvatar,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { displaySessionTitle } from "@/app/lib/format";
import { routes } from "@/app/lib/routes";
import { useSessions } from "@/app/services/queries";

export function Breadcrumbs() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { data: sessions = [] } = useSessions();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = sessionId
    ? sessions.find((entry) => entry.summary.session_id === sessionId)?.summary
    : undefined;

  return (
    <nav className="flex items-center min-w-0" aria-label="Breadcrumb">
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
          <div className="relative min-w-0" ref={rootRef}>
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
              <span className="truncate">
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

            {open ? (
              <div
                className="absolute left-0 z-30 mt-1 w-[320px] max-h-[420px] overflow-auto fade
                           flex flex-col gap-1 p-2 rounded-[8px] bg-elevation-level-2 border border-secondary shadow-xl
                           [&>*]:shrink-0"
              >
                {sessions.length === 0 ? (
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
                )}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </nav>
  );
}
