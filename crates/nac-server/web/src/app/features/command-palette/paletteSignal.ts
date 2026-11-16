import { useEffect, useRef, useSyncExternalStore } from "react";

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

/**
 * The sidebar owns its open state; the palette only asks. The sidebar
 * registers a handler while it is mounted (`useSidebarToggleRequests`), and
 * the palette offers "Toggle sidebar" only while one is registered.
 */
const sidebarHandlers = new Set<() => void>();
const sidebarListeners = new Set<() => void>();

function notifySidebarOwners() {
  for (const listener of sidebarListeners) listener();
}

export function registerSidebarToggle(handler: () => void): () => void {
  sidebarHandlers.add(handler);
  notifySidebarOwners();
  return () => {
    sidebarHandlers.delete(handler);
    notifySidebarOwners();
  };
}

/** Asks the mounted sidebar to toggle. False when no sidebar is on screen. */
export function requestSidebarToggle(): boolean {
  const handler = [...sidebarHandlers].at(-1);
  if (!handler) return false;
  handler();
  return true;
}

function subscribeSidebar(listener: () => void) {
  sidebarListeners.add(listener);
  return () => sidebarListeners.delete(listener);
}

export function useSidebarToggleAvailable(): boolean {
  return useSyncExternalStore(
    subscribeSidebar,
    () => sidebarHandlers.size > 0,
    () => false,
  );
}

/** For the sidebar: answer palette "Toggle sidebar" requests while mounted. */
export function useSidebarToggleRequests(handler: (() => void) | null): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const enabled = handler !== null;
  useEffect(() => {
    if (!enabled) return undefined;
    return registerSidebarToggle(() => latest.current?.());
  }, [enabled]);
}
