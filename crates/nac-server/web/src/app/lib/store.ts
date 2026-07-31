import { useSyncExternalStore } from "react";

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

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<Listener>();

  const getState = () => state;

  const setState = (patch: Patch<S>) => {
    const next = typeof patch === "function" ? patch(state) : patch;
    if (!next || (next as unknown) === (state as unknown)) return;
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const identity = (s: S) => s as unknown;

  const useStore = <T = S>(selector?: (state: S) => T): T => {
    const select = (selector ?? identity) as (state: S) => T;
    // Both snapshots read the same live state, so the server snapshot used
    // during hydration cannot diverge from the client one.
    const snapshot = () => select(state);
    return useSyncExternalStore(subscribe, snapshot, snapshot);
  };

  return { getState, setState, subscribe, useStore };
}
