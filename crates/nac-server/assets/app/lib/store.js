import { React } from "./html.js";

const { useSyncExternalStore, useRef } = React;

// Minimal external store (no Redux). State is a plain object updated immutably
// via setState (object patch or updater fn). Components subscribe with a
// selector; they only re-render when the selected slice changes by Object.is,
// so selectors should return primitives or stable references from state.
export function createStore(initial) {
  let state = initial;
  const listeners = new Set();

  const getState = () => state;

  const setState = (patch) => {
    const next = typeof patch === "function" ? patch(state) : patch;
    if (!next || next === state) return;
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  };

  const subscribe = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };

  const identity = (s) => s;

  const useStore = (selector = identity) => {
    const snap = () => selector(state);
    return useSyncExternalStore(subscribe, snap, snap);
  };

  return { getState, setState, subscribe, useStore };
}

// Stable ref for a selector-derived value (rarely needed; selectors should
// pick stable slices). Exposed for convenience in components.
export function useStable(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
