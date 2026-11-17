import { createContext, useContext } from "react";
import { useNavigate } from "react-router-dom";

import {
  usePresentationInertTarget,
  usePresentationLayers,
} from "@/app/providers/PresentationBoundary";

import { routes } from "@/app/lib/routes";

/** A session's composer, or Home's. */
const COMPOSER = 'textarea[role="combobox"][aria-label="Message"], textarea#home-composer';

/** One presentation owns the lifetime and identity of its deferred return. */
export function createSettingsReturnOwner() {
  let origin: string | null = null;
  let active = true;
  let pending: { destination: string } | null = null;
  return {
    origin: () => origin,
    activate: () => {
      active = true;
    },
    deactivate: () => {
      active = false;
      pending = null;
    },
    location: (location: string, isSettings: boolean) => {
      if (pending?.destination !== location) pending = null;
      if (!isSettings) origin = location;
    },
    begin: (destination: string) => (pending = { destination }),
    current: (request: { destination: string }) =>
      active && pending === request && origin === request.destination,
    retire: (request: { destination: string }) => {
      if (pending === request) pending = null;
    },
  };
}
export const SettingsReturnContext = createContext<ReturnType<
  typeof createSettingsReturnOwner
> | null>(null);

/**
 * Settings' ← Back: return to wherever the user was before Settings took over
 * the window, or Home when they arrived on a Settings link directly.
 */
export function useSettingsReturn(): () => void {
  const state = useContext(SettingsReturnContext);
  const navigate = useNavigate();
  const content = usePresentationInertTarget();
  const layers = usePresentationLayers();
  return () => {
    const destination = state?.origin() ?? routes.list();
    const pending = state?.begin(destination) ?? { destination };
    const opener = typeof document === "undefined" ? null : document.activeElement;
    navigate(destination);
    // The dialogs Settings replaced returned focus into the view; do the same
    // once the destination has rendered: its composer, else its main region.
    if (typeof window === "undefined") return;
    // A selector list matches in document order, and the app shell's <main>
    // encloses every composer: look for a composer first, the region last.
    let frames = 0;
    const retire = () => {
      state?.retire(pending);
    };
    const settle = () => {
      if ((content && !content.isConnected) || (state && !state.current(pending))) {
        retire();
        return;
      }
      // A newer overlay or focus destination owns the keyboard now. This old
      // route handoff must not front Home over an interaction already underway.
      const active = document.activeElement;
      if (
        layers.openDepth() > 0 ||
        (active &&
          active !== opener &&
          active.isConnected &&
          active !== document.body &&
          active !== document.documentElement)
      ) {
        retire();
        return;
      }
      const root = content ?? document;
      const composer = root.querySelector<HTMLElement>(COMPOSER);
      const target = composer ?? (++frames < 20 ? null : root.querySelector<HTMLElement>("main"));
      if (target) {
        if (target.tagName === "MAIN" && !target.hasAttribute("tabindex"))
          target.setAttribute("tabindex", "-1");
        retire();
        target.focus({ preventScroll: true });
      } else if (frames < 20) requestAnimationFrame(settle);
      else retire();
    };
    requestAnimationFrame(settle);
  };
}
