import { useSyncExternalStore } from "react";

/**
 * The ⌘K palette and the ⌘/ shortcut sheet are opened from many places (the
 * sidebar's Search pill, the mobile header, keyboard). This tiny signal is
 * the shared switch; the palette owner renders the UI.
 */
type Surface = "palette" | "shortcuts" | null;

let open: Surface = null;
const listeners = new Set<() => void>();

function emit(next: Surface) {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

export function openCommandPalette(): void {
  emit("palette");
}

export function openShortcutSheet(): void {
  emit("shortcuts");
}

export function closeCommandSurfaces(): void {
  emit(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCommandSurface(): Surface {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => null,
  );
}
