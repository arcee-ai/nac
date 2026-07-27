import { React, html } from "../lib/html.js";
import { cn } from "../lib/cn.js";
import { Button, ButtonVariant, ButtonContent, ButtonSize } from "./button.js";
import { Icon } from "./icon.js";

const { useEffect, useRef } = React;
const createPortal = window.ReactDOM.createPortal;

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const ModalSize = {
  Small: "max-w-[400px]",
  Medium: "max-w-[560px]",
  Large: "max-w-[760px]",
};

// Generic dialog: overlay + centered card. Closes on overlay click / Escape.
export function Modal({
  open,
  onClose,
  title,
  size = ModalSize.Medium,
  closeOnOverlay = true,
  className = "",
  children,
  footer,
}) {
  const cardRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Autofocus the first meaningful field and trap Tab within the dialog.
  useEffect(() => {
    if (!open) return undefined;
    const card = cardRef.current;
    if (!card) return undefined;
    const focusables = () => Array.from(card.querySelectorAll(FOCUSABLE));
    const list = focusables();
    const preferred = list.find((el) => /input|textarea|select/i.test(el.tagName)) || list[0];
    if (preferred) preferred.focus();

    const onKey = (e) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    card.addEventListener("keydown", onKey);
    return () => card.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const node = html`
    <div
      class="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style=${{ background: "var(--color-bg-scrim, rgba(0,0,0,0.55))" }}
      onMouseDown=${(e) => closeOnOverlay && e.target === e.currentTarget && onClose && onClose()}
    >
      <div
        ref=${cardRef}
        role="dialog"
        aria-modal="true"
        class=${cn(
          "popup-bounce w-full flex flex-col gap-4 rounded-[8px] p-5",
          "bg-elevation-level-1 border border-secondary shadow-2xl",
          size,
          className,
        )}
      >
        ${title || onClose
          ? html`<div class="flex items-start justify-between gap-4">
              <div class="header-medium text-basic-primary">${title}</div>
              <${Button}
                variant=${ButtonVariant.Tertiary}
                size=${ButtonSize.Small}
                content=${ButtonContent.Icon}
                className="btn-icon-rotate -mr-1"
                onClick=${onClose}
              >
                <${Icon} name="close" />
              </${Button}>
            </div>`
          : null}
        <div class="paragraph-medium text-basic-secondary">${children}</div>
        ${footer ? html`<div class="flex justify-end gap-2">${footer}</div>` : null}
      </div>
    </div>
  `;
  return createPortal(node, document.body);
}
