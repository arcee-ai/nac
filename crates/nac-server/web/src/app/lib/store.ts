import { useSyncExternalStore } from "react";

import { perfMark } from "@/app/lib/perfDebug";

// Minimal external store. Server data lives in TanStack Query; this is only for
// client state that several unrelated components read, such as the current
// selection or the live run status derived from the event stream.

type Listener = () => void;
type Patch<S> = Partial<S> | ((state: S) => Partial<S> | null | undefined);

export interface Store<S> {
  getState: () => S;
  setState: (patch: Patch<S>) => void;
  subscribe: (listener: Listener) => () => void;
  useStore: <T = S>(selector?: (state: S) => T) => T;
}

export function createStore<S extends object>(
  initial: S,
  /** Names the store in the dev perf report; has no effect otherwise. */
  name = "store",
): Store<S> {
  let state = initial;
  const listeners = new Set<Listener>();

  const getState = () => state;

  const setState = (patch: Patch<S>) => {
    const next = patch instanceof Function ? patch(state) : patch;
    if (!next || next === state) return;
    state = { ...state, ...next };
    perfMark(`store:${name}.notify`, {
      fields: { keys: Object.keys(next).join("+"), listeners: listeners.size },
      throttleMs: 1000,
    });
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const identity = (s: S): S => s;

  const useStore = <T = S>(selector?: (state: S) => T): T => {
    // SAFETY: when no selector is given, T defaults to S and identity returns
    // the state itself, so the cast only widens the no-selector branch.
    const select = (selector ?? identity) as (state: S) => T;
    // Both snapshots read the same live state, so the server snapshot used
    // during hydration cannot diverge from the client one.
    const snapshot = () => select(state);
    return useSyncExternalStore(subscribe, snapshot, snapshot);
  };

  return { getState, setState, subscribe, useStore };
}
