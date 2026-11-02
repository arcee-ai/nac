import { useLayoutEffect, useRef } from "react";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import {
  usePresentationKeyboardOwner,
  usePresentationLayers,
} from "@/app/providers/PresentationBoundary";
import { connectSessionTargets, type DesktopSessionTargetPort } from "./sessionTarget";
import { useDesktopVisible } from "./visibility";

/** Explicit notification response only; existing shared routing owns the view. */
export function DesktopSessionTargetOwner({ port }: { port: DesktopSessionTargetPort }) {
  const runtime = useNativeRuntime();
  const ownsKeyboard = usePresentationKeyboardOwner();
  const layers = usePresentationLayers();
  const visible = useDesktopVisible();
  const composing = useRef(false);
  const latest = useRef({ ownsKeyboard, layers });
  useLayoutEffect(() => {
    latest.current = { ownsKeyboard, layers };
  });
  useLayoutEffect(() => {
    if (!port.connectSessionTarget) return;
    const start = () => {
      composing.current = true;
    };
    const end = () => {
      composing.current = false;
    };
    document.addEventListener("compositionstart", start, true);
    document.addEventListener("compositionend", end, true);
    return () => {
      document.removeEventListener("compositionstart", start, true);
      document.removeEventListener("compositionend", end, true);
    };
  }, [port]);
  useLayoutEffect(() => {
    if (!port.connectSessionTarget || !visible) return;
    const canNavigate = () => {
      const element = document.activeElement;
      if (
        composing.current ||
        latest.current.layers.modalDepth() > 0 ||
        !latest.current.ownsKeyboard(element)
      )
        return false;
      // Runtime-owned composer drafts survive a session route. Other local
      // editors have no retained owner and must be explicitly left by the user.
      return !(
        element instanceof HTMLElement &&
        (element.matches("input,textarea,select") || element.isContentEditable) &&
        !element.hasAttribute("data-nac-retained-draft")
      );
    };
    const close = connectSessionTargets(
      port,
      (target, signal) =>
        runtime.productNavigation?.openNotificationSessionTarget(target, signal, canNavigate) ??
        Promise.resolve("unavailable"),
    );
    return close;
  }, [port, runtime, visible]);
  return null;
}
