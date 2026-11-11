import { useLayoutEffect, useRef } from "react";
import { useSidebarCommands } from "@/app/components/LeftSidebar/useSidebarCommands";
import {
  usePresentationKeyboardOwner,
  usePresentationLayers,
} from "@/app/providers/PresentationBoundary";
import { connectDesktopCommands, type DesktopCommandPort } from "./adapter";

/** One connected owner per presentation; routing/dialog/focus remain shared. */
export function DesktopCommandOwner({ port }: { port: DesktopCommandPort }) {
  const commands = useSidebarCommands();
  const ownsKeyboard = usePresentationKeyboardOwner();
  const layers = usePresentationLayers();
  const latest = useRef({ commands, ownsKeyboard, layers });
  useLayoutEffect(() => {
    latest.current = { commands, ownsKeyboard, layers };
  });
  useLayoutEffect(() => {
    const invoke = (action: () => boolean | void) => {
      const { ownsKeyboard, layers } = latest.current;
      if (
        !document.hasFocus() ||
        !ownsKeyboard(document.activeElement) ||
        layers.modalDepth() > 0
      ) {
        throw new Error("The workspace does not own keyboard focus");
      }
      return action();
    };
    return connectDesktopCommands(port, {
      newSession: () => invoke(() => latest.current.commands.newSession()),
      settings: () => invoke(() => latest.current.commands.openConfigurations()),
      projects: () =>
        invoke(() => {
          void latest.current.commands.openProjects();
        }),
    });
  }, [port]);
  return null;
}
