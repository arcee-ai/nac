import { useCallback, useEffect, useState } from "react";

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

let stack: ModalStackItem[] = [];
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((listener) => listener());
};

const push = (item: ModalStackItem) => {
  stack = [...stack, item];
  notify();
};

const pop = (id: ModalId) => {
  stack = stack.filter((item) => item.id !== id);
  notify();
};

/**
 * How many dialogs are up, for code that reads it inside an event rather than
 * rendering against it — a global shortcut, which a dialog outranks.
 */
export const modalStackDepth = (): number => stack.length;

/**
 * Shared stack for nested dialogs. Mobile uses it to slide lower sheets aside;
 * Escape uses it so only the topmost dialog dismisses.
 */
export const useModalStack = () => {
  const [, bump] = useState(0);

  useEffect(() => {
    const onChange = () => bump((n) => n + 1);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  const pushModal = useCallback((item: ModalStackItem) => {
    push(item);
  }, []);

  const popModal = useCallback((id: ModalId) => {
    pop(id);
  }, []);

  const isModalOnTop = useCallback((id: ModalId): boolean => {
    if (stack.length === 0) return true;
    return stack[stack.length - 1]?.id === id;
  }, []);

  const getStackLength = useCallback(() => stack.length, []);

  return {
    modalStack: stack,
    pushModal,
    popModal,
    isModalOnTop,
    getStackLength,
  };
};
