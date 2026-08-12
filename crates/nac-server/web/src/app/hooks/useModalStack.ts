import { useCallback, useEffect, useState } from "react";

export interface ModalStackItem {
  id: object;
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

const pop = (id: object) => {
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

  const popModal = useCallback((id: object) => {
    pop(id);
  }, []);

  const isModalOnTop = useCallback((id: object): boolean => {
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
