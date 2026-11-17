import { createContext, useContext, type RefObject } from "react";
import { useNavigate } from "react-router-dom";

import { usePresentationInertTarget } from "@/app/providers/PresentationBoundary";

import { routes } from "@/app/lib/routes";

/** A session's composer, or Home's. */
const COMPOSER = 'textarea[role="combobox"][aria-label="Message"], textarea#home-composer';

/** The last place outside Settings, kept by `SettingsReturnProvider`. */
export const SettingsReturnContext = createContext<RefObject<string | null> | null>(null);

/**
 * Settings' ← Back: return to wherever the user was before Settings took over
 * the window, or Home when they arrived on a Settings link directly.
 */
export function useSettingsReturn(): () => void {
  const origin = useContext(SettingsReturnContext);
  const navigate = useNavigate();
  const content = usePresentationInertTarget();
  return () => {
    const destination = origin?.current ?? routes.list();
    navigate(destination);
    // The dialogs Settings replaced returned focus into the view; do the same
    // once the destination has rendered: its composer, else its main region.
    if (typeof window === "undefined") return;
    // A selector list matches in document order, and the app shell's <main>
    // encloses every composer: look for a composer first, the region last.
    let frames = 0;
    const settle = () => {
      if (content && !content.isConnected) return;
      if (origin && origin.current !== destination) return;
      const root = content ?? document;
      const composer = root.querySelector<HTMLElement>(COMPOSER);
      const target = composer ?? (++frames < 20 ? null : root.querySelector<HTMLElement>("main"));
      if (target) {
        if (target.tagName === "MAIN" && !target.hasAttribute("tabindex"))
          target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      } else if (frames < 20) requestAnimationFrame(settle);
    };
    requestAnimationFrame(settle);
  };
}
