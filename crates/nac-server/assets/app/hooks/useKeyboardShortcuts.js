import { React } from "../lib/html.js";
import {
  selectSession,
  setActiveTab,
  setMobileDetailOpen,
  toggleInspectorFullscreen,
  TABS,
} from "../store/selectionStore.js";
import { loadSnapshot, clearAttention } from "../store/sessionsStore.js";

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

    const move = (delta) => {
      const ids = idsOf();
      if (ids.length === 0) return;
      const cur = ids.indexOf(ref.current.selectedId);
      const next = cur < 0 ? 0 : (cur + delta + ids.length) % ids.length;
      clearAttention(ids[next]);
      selectSession(ids[next]);
      loadSnapshot(ids[next]);
    };

    const onKeyDown = (e) => {
      const { modal, selectedId, closeModal, openLaunch } = ref.current;
      const typing = isTypingTarget(e.target);

      // Escape works everywhere (also unfocuses inputs).
      if (e.key === "Escape") {
        if (typing) return; // let inputs handle their own escape
        if (modal) {
          closeModal();
          e.preventDefault();
        } else if (selectedId) {
          setMobileDetailOpen(false);
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
        case "f":
          if (selectedId) {
            e.preventDefault();
            toggleInspectorFullscreen();
          }
          break;
        case "/":
          if (selectedId) {
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
          if (!selectedId) break;
          const tab = TABS[Number(e.key) - 1];
          if (tab) {
            e.preventDefault();
            setActiveTab(tab);
            setMobileDetailOpen(true);
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
