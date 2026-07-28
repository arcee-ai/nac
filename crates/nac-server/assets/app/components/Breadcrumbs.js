import { React, html } from "../lib/html.js";
import { Icon } from "../atoms/icon.js";
import { Button, ButtonVariant, ButtonSize, ButtonContent } from "../atoms/button.js";
import { SessionAvatar } from "../atoms/session-avatar.js";
import { displaySessionTitle } from "../lib/format.js";
import { useSessions } from "../store/sessionsStore.js";
import { ROUTE_SESSION, openList, openSession, useRoute, useRouteSessionId } from "../store/routeStore.js";

const { useState, useRef, useEffect } = React;

const summaryOf = (entry) => entry.summary || entry;

export function Breadcrumbs() {
  const route = useRoute();
  const sessionId = useRouteSessionId();
  const sessions = useSessions();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onSession = route === ROUTE_SESSION && sessionId;
  const current = onSession
    ? sessions.map(summaryOf).find((s) => s.session_id === sessionId)
    : null;

  return html`<nav class="flex items-center min-w-0" aria-label="Breadcrumb">
    <${Button}
      variant=${ButtonVariant.Ghost}
      size=${ButtonSize.Medium}
      content=${ButtonContent.Text}
      onClick=${openList}
      aria-current=${onSession ? undefined : "page"}
    >
      All Sessions
    </${Button}>
    ${onSession
      ? html`<${Icon} name="right" size=${16} className="text-basic-muted shrink-0" />
          <div class="relative min-w-0" ref=${rootRef}>
            <${Button}
              variant=${ButtonVariant.Ghost}
              size=${ButtonSize.Medium}
              content=${ButtonContent.Text}
              className="max-w-[320px] px-2"
              onClick=${() => setOpen((v) => !v)}
              aria-expanded=${open ? "true" : "false"}
              aria-label="Switch session"
            >
              <${SessionAvatar} id=${sessionId} size=${20} className="rounded-[2px]" />
              <span class="truncate">${displaySessionTitle(current || { session_id: sessionId })}</span>
              <${Icon}
                name="down"
                size=${16}
                className=${open ? "rotate-180 transition-transform" : "transition-transform"}
              />
            </${Button}>
            ${open
              ? html`<div
                  class="absolute left-0 z-30 mt-1 w-[320px] max-h-[420px] overflow-auto fade
                         flex flex-col gap-1 p-2 rounded-[8px] bg-elevation-level-2 border border-secondary shadow-xl
                         [&>*]:shrink-0"
                >
                  ${sessions.length === 0
                    ? html`<div class="label-small text-basic-muted px-2 py-1">No sessions</div>`
                    : sessions.map((entry) => {
                        const s = summaryOf(entry);
                        const active = s.session_id === sessionId;
                        return html`<button
                          key=${s.session_id}
                          type="button"
                          class=${`flex items-center gap-2 min-w-0 px-2 py-1.5 rounded-[4px] text-left
                                   hover:bg-btn-ghost-hovered ${active ? "bg-btn-ghost-highlighted" : ""}`}
                          onClick=${() => {
                            setOpen(false);
                            openSession(s.session_id);
                          }}
                        >
                          <${SessionAvatar} id=${s.session_id} size=${20} className="rounded-[2px]" />
                          <span class="label-small text-basic-primary truncate">${displaySessionTitle(s)}</span>
                        </button>`;
                      })}
                </div>`
              : null}
          </div>`
      : null}
  </nav>`;
}
