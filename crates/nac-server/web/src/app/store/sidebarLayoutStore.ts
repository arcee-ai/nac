import { Atom } from "effect/reactivity";
import { useAtomSet, useAtomValue } from "@effect/atom-react";

/** Pixels the session sidebar reserves. Zero when that sidebar is not mounted. */
export const sidebarOffsetAtom = Atom.keepAlive(Atom.make(0));

export function useSidebarOffset(): number {
  return useAtomValue(sidebarOffsetAtom);
}

export function useSetSidebarOffset(): (offset: number) => void {
  return useAtomSet(sidebarOffsetAtom);
}
