import { useSyncExternalStore } from "react";

import { appAtomRegistry } from "@/app/effect/registry";
import { perfMark } from "@/app/lib/perfDebug";
import { Atom } from "effect/reactivity";

// Client view state shared by unrelated components. Server data stays in
// the Effect server atoms. Each store is one keep-alive atom on the page registry:
// idle cleanup must not drop a preference while nothing is mounted, and a
// reader outside React has to see the same value as `useStore`.

type Listener = () => void;
type Patch<S> = Partial<S> | ((state: S) => Partial<S> | null | undefined);

export interface Store<S> {
  getState: () => S;
  setState: (patch: Patch<S>) => void;
  subscribe: (listener: Listener) => () => void;
  useStore: <T = S>(selector?: (state: S) => T) => T;
}

const identity = <S>(state: S): S => state;

export function createStore<S extends object>(
  initial: S,
  /** Names the store in the dev perf report; has no effect otherwise. */
  name = "store",
): Store<S> {
  const atom: Atom.Writable<S> = Atom.keepAlive(Atom.make(initial));

  const getState = () => appAtomRegistry.get(atom);

  const setState = (patch: Patch<S>) => {
    const state = getState();
    const next = patch instanceof Function ? patch(state) : patch;
    if (!next || next === state) return;
    appAtomRegistry.set(atom, { ...state, ...next });
    perfMark(`store:${name}.notify`, {
      fields: { keys: Object.keys(next).join("+") },
      throttleMs: 1000,
    });
  };

  const subscribe = (listener: Listener) => appAtomRegistry.subscribe(atom, () => listener());

  const useStore = <T = S>(selector?: (state: S) => T): T => {
    // Selectors are inline at the call site, and unit tests render without the
    // page provider. Subscribing to this registry directly keeps both on the
    // atom `getState` writes. `useAtomValue` would read a different registry
    // whenever that provider is absent.
    const select = (selector ?? identity) as (state: S) => T;
    const snapshot = () => select(getState());
    return useSyncExternalStore(subscribe, snapshot, snapshot);
  };

  return { getState, setState, subscribe, useStore };
}
