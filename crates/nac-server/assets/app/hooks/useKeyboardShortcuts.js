import { React } from "../lib/html.js";
import { selectSession, setActiveTab, TABS } from "../store/selectionStore.js";
import { routeStore, ROUTE_SESSION, openList, openSession } from "../store/routeStore.js";
import { clearAttention } from "../store/sessionsStore.js";

const { useEffect, useRef } = React;

const isTypingTarget = (el) => {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
};

// Global keyboard shortcuts. `ctx` is a live ref-like object so handlers always
// see current sessions/selection/modal without re-binding the listener.
export function useKeyboardShortcuts(ctx) {
  const ref = useRef(ctx);
  ref.current = ctx;

  useEffect(() => {
    const idsOf = () => ref.current.sessions.map((e) => (e.summary || e).session_id);

    // On the list, j/k only moves the highlight; on a session screen it also
    // navigates, so the shortcut means "next session" in both places.
    const move = (delta) => {
      const ids = idsOf();
      if (ids.length === 0) return;
      const cur = ids.indexOf(ref.current.selectedId);
      const next = ids[cur < 0 ? 0 : (cur + delta + ids.length) % ids.length];
      if (routeStore.getState().name === ROUTE_SESSION) {
        openSession(next);
      } else {
        clearAttention(next);
        selectSession(next);
      }
    };

    const onKeyDown = (e) => {
      const { modal, closeModal, openLaunch } = ref.current;
      const onSession = routeStore.getState().name === ROUTE_SESSION;
      const typing = isTypingTarget(e.target);

      // Escape works everywhere (also unfocuses inputs).
      if (e.key === "Escape") {
        if (typing) return; // let inputs handle their own escape
        if (modal) {
          closeModal();
          e.preventDefault();
        } else if (onSession) {
          e.preventDefault();
          openList();
        }
        return;
      }

      // Everything below is ignored while typing or with modifiers.
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (modal) return;

      switch (e.key) {
        case "n":
          e.preventDefault();
          openLaunch();
          break;
        case "j":
          e.preventDefault();
          move(1);
          break;
        case "k":
          e.preventDefault();
          move(-1);
          break;
        case "Enter":
          if (!onSession && ref.current.selectedId) {
            e.preventDefault();
            openSession(ref.current.selectedId);
          }
          break;
        case "/":
          if (onSession) {
            const el = document.querySelector('[data-prompt-input="true"]');
            if (el) {
              e.preventDefault();
              setActiveTab("chat");
              el.focus();
            }
          }
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5": {
          if (!onSession) break;
          const tab = TABS[Number(e.key) - 1];
          if (tab) {
            e.preventDefault();
            setActiveTab(tab);
          }
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
