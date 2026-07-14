import { React, html } from "../lib/html.js";
import { Toast, ToastVariant } from "../atoms/toast.js";

const { createContext, useContext, useState, useCallback, useEffect, useRef } = React;
const createPortal = window.ReactDOM.createPortal;

export { ToastVariant };

const ToastContext = createContext(null);
const ANIMATION_MS = 300;
const DEFAULT_LIFE = 3;

let seq = 0;
const uid = () => `toast-${Date.now()}-${seq++}`;

function ToastContainer({ toasts, removeToast }) {
  const timers = useRef(new Map());

  useEffect(() => {
    const map = timers.current;
    for (const t of toasts) {
      if (!t.keep && !t.dismissing && !map.has(t.id)) {
        map.set(t.id, setTimeout(() => removeToast(t.id), t.life * 1000));
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

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  if (toasts.length === 0) return null;
  return createPortal(
    html`<div class="fixed top-4 right-4 z-[1100] flex flex-col gap-2 pointer-events-none">
      ${toasts.map(
        (t) => html`<div key=${t.id} class="pointer-events-auto">
          <${Toast}
            content=${t.content}
            variant=${t.variant}
            dismissing=${t.dismissing}
            onClose=${() => removeToast(t.id)}
          />
        </div>`,
      )}
    </div>`,
    document.body,
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((params) => {
    const id = uid();
    const t = {
      id,
      content: params.content,
      variant: params.variant ?? ToastVariant.Info,
      life: params.life ?? DEFAULT_LIFE,
      keep: params.keep ?? false,
      dismissing: false,
    };
    setToasts((prev) => [...prev, t]);
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => {
      const target = prev.find((t) => t.id === id);
      if (!target || target.dismissing) return prev;
      setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), ANIMATION_MS);
      return prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t));
    });
  }, []);

  const clearToasts = useCallback(() => {
    setToasts((prev) => {
      if (prev.length === 0) return prev;
      setTimeout(() => setToasts((cur) => cur.filter((t) => !t.dismissing)), ANIMATION_MS);
      return prev.map((t) => ({ ...t, dismissing: true }));
    });
  }, []);

  // Convenience helpers so callers can `toast.success("...")`.
  const value = {
    addToast,
    removeToast,
    clearToasts,
    info: (content, opts) => addToast({ content, variant: ToastVariant.Info, ...opts }),
    success: (content, opts) => addToast({ content, variant: ToastVariant.Success, ...opts }),
    error: (content, opts) => addToast({ content, variant: ToastVariant.Error, ...opts }),
    danger: (content, opts) => addToast({ content, variant: ToastVariant.Danger, ...opts }),
  };

  return html`<${ToastContext.Provider} value=${value}>
    ${children}
    <${ToastContainer} toasts=${toasts} removeToast=${removeToast} />
  </${ToastContext.Provider}>`;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
