import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import Toast, { ToastVariant } from "@/app/atoms/toast/Toast";
import type { RunError } from "@/app/lib/providerError";

export { ToastVariant };

interface ToastOptions {
  /** Seconds before the toast dismisses itself. */
  life?: number;
  /** Keep the toast until it is dismissed explicitly. */
  keep?: boolean;
}

interface ToastRecord extends Required<ToastOptions> {
  id: string;
  content: React.ReactNode;
  variant: ToastVariant;
  dismissing: boolean;
}

interface ToastApi {
  addToast: (
    params: { content: React.ReactNode; variant?: ToastVariant } & ToastOptions,
  ) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
  info: (content: React.ReactNode, options?: ToastOptions) => string;
  success: (content: React.ReactNode, options?: ToastOptions) => string;
  error: (content: React.ReactNode, options?: ToastOptions) => string;
  danger: (content: React.ReactNode, options?: ToastOptions) => string;
}

const ToastContext = createContext<ToastApi | null>(null);

// Must match the transition in the Toast atom, otherwise the node is removed
// before it has finished sliding out.
const ANIMATION_MS = 150;
const DEFAULT_LIFE = 3;

let seq = 0;
const uid = () => `toast-${Date.now()}-${seq++}`;

function ToastContainer({
  toasts,
  removeToast,
}: {
  toasts: ToastRecord[];
  removeToast: (id: string) => void;
}) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const map = timers.current;
    for (const toast of toasts) {
      if (!toast.keep && !toast.dismissing && !map.has(toast.id)) {
        map.set(
          toast.id,
          setTimeout(() => removeToast(toast.id), toast.life * 1000),
        );
      }
    }
    const active = new Set(toasts.map((t) => t.id));
    for (const [id, timer] of map) {
      if (!active.has(id)) {
        clearTimeout(timer);
        map.delete(id);
      }
    }
  }, [toasts, removeToast]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((timer) => clearTimeout(timer));
  }, []);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed top-4 right-4 z-[1100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast
            content={toast.content}
            variant={toast.variant}
            dismissing={toast.dismissing}
            onClose={() => removeToast(toast.id)}
          />
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const addToast = useCallback<ToastApi["addToast"]>((params) => {
    const id = uid();
    setToasts((prev) => [
      ...prev,
      {
        id,
        content: params.content,
        variant: params.variant ?? ToastVariant.Info,
        life: params.life ?? DEFAULT_LIFE,
        keep: params.keep ?? false,
        dismissing: false,
      },
    ]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => {
      const target = prev.find((t) => t.id === id);
      if (!target || target.dismissing) return prev;
      setTimeout(
        () => setToasts((cur) => cur.filter((t) => t.id !== id)),
        ANIMATION_MS,
      );
      return prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t));
    });
  }, []);

  const clearToasts = useCallback(() => {
    setToasts((prev) => {
      if (prev.length === 0) return prev;
      setTimeout(
        () => setToasts((cur) => cur.filter((t) => !t.dismissing)),
        ANIMATION_MS,
      );
      return prev.map((t) => ({ ...t, dismissing: true }));
    });
  }, []);

  const value = useMemo<ToastApi>(
    () => ({
      addToast,
      removeToast,
      clearToasts,
      info: (content, options) =>
        addToast({ content, variant: ToastVariant.Info, ...options }),
      success: (content, options) =>
        addToast({ content, variant: ToastVariant.Success, ...options }),
      error: (content, options) =>
        addToast({ content, variant: ToastVariant.Error, ...options }),
      danger: (content, options) =>
        addToast({ content, variant: ToastVariant.Danger, ...options }),
    }),
    [addToast, removeToast, clearToasts],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

/** Format a rejection for display in a toast. */
export function errorMessage(error: RunError): string {
  return error instanceof Error ? error.message : String(error);
}
