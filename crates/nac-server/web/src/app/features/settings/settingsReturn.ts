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
  return () => navigate(origin?.current ?? routes.list());
}
