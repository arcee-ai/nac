import { createContext, useContext, type RefObject } from "react";
import { useNavigate } from "react-router-dom";

import { routes } from "@/app/lib/routes";

/** The last place outside Settings, kept by `SettingsReturnProvider`. */
export const SettingsReturnContext = createContext<RefObject<string | null> | null>(null);

/**
 * Settings' ← Back: return to wherever the user was before Settings took over
 * the window, or Home when they arrived on a Settings link directly.
 */
export function useSettingsReturn(): () => void {
  const origin = useContext(SettingsReturnContext);
  const navigate = useNavigate();
  return () => {
    navigate(origin?.current ?? routes.list());
    // The dialogs Settings replaced returned focus into the view; do the same
    // once the destination has rendered: its composer, else its main region.
    if (typeof window === "undefined") return;
    let frames = 0;
    const settle = () => {
      const target = document.querySelector<HTMLElement>(
        'textarea[role="combobox"][aria-label="Message"], textarea[aria-label="What should we work on?"], main',
      );
      if (target) {
        if (target.tagName === "MAIN" && !target.hasAttribute("tabindex"))
          target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      } else if (++frames < 20) requestAnimationFrame(settle);
    };
    requestAnimationFrame(settle);
  };
}
