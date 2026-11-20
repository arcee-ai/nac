import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import { NEW_SESSION_KEYS } from "@/app/lib/shortcuts";

import { useNewSession } from "./useSidebarCommands";

/** ⌘⇧O on every route: the same New session the sidebar and palette run. */
export function NewSessionShortcut() {
  const { newSession } = useNewSession();
  useKeyboardShortcuts([{ keys: NEW_SESSION_KEYS, onTrigger: () => void newSession() }]);
  return null;
}
