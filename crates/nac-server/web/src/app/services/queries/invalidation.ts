import type { AtomRegistry } from "effect/reactivity";

import { refreshPrefixed } from "@/app/effect/remote";
import { atomIds } from "@/app/services/queries/keys";

/** Refresh helpers shared by commands that used to invalidate query keys. */

export function refreshSessionList(registry: AtomRegistry.AtomRegistry): Promise<void> {
  return refreshPrefixed(registry, "sessions");
}

export function refreshProjects(registry: AtomRegistry.AtomRegistry): Promise<void> {
  return refreshPrefixed(registry, atomIds.projects);
}

/** One session snapshot. Does not refresh the rest of that session. */
export function refreshSession(registry: AtomRegistry.AtomRegistry, id: string): Promise<void> {
  return refreshPrefixed(registry, atomIds.snapshot(id));
}

/** Every atom under one session: snapshot, workspace, permissions, goal, inbox, children. */
export function refreshSessionRoot(registry: AtomRegistry.AtomRegistry, id: string): Promise<void> {
  return refreshPrefixed(registry, atomIds.session(id));
}
