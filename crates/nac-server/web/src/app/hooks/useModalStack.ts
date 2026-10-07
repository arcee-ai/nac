import { createContext, useContext, useSyncExternalStore } from "react";

declare const modalIdBrand: unique symbol;

/** Opaque identity token of one dialog instance in the shared stack. */
export interface ModalId {
  readonly [modalIdBrand]: true;
}

/**
 * Mint a fresh identity token for one dialog instance. The only way to obtain
 * a `ModalId`, so a token always names a real dialog.
 */
export const createModalId = (): ModalId => {
  // SAFETY: the brand is a type-level-only marker (declared, never emitted), so
  // a plain object literal is a valid token; the brand only stops other modules
  // from forging one.
  return {} as ModalId;
};

export interface ModalStackItem {
  id: ModalId;
}

export function createModalStack() {
  let stack: ModalStackItem[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => stack,
    pushModal: (item: ModalStackItem) => {
      stack = [...stack, item];
      notify();
    },
    popModal: (id: ModalId) => {
      stack = stack.filter((item) => item.id !== id);
      notify();
    },
    isModalOnTop: (id: ModalId) => stack.length === 0 || stack.at(-1)?.id === id,
    getStackLength: () => stack.length,
  };
}
const standalone = createModalStack();
export const ModalStackContext = createContext<ReturnType<typeof createModalStack> | null>(null);
export const modalStackDepth = standalone.getStackLength;

/**
 * Shared stack for nested dialogs. Mobile uses it to slide lower sheets aside;
 * Escape uses it so only the topmost dialog dismisses.
 */
export const useModalStack = () => {
  const store = useContext(ModalStackContext) ?? standalone;
  const modalStack = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...store, modalStack };
};
