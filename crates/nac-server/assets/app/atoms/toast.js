import { React, html } from "../lib/html.js";
import { cn } from "../lib/cn.js";
import { Icon } from "./icon.js";
import { Button, ButtonVariant, ButtonContent } from "./button.js";

const { useState, useEffect, useRef } = React;
const { createRoot } = window.ReactDOM;

export const ToastVariant = {
  Info: "info",
  Success: "success",
  Error: "error",
  Danger: "danger",
};

const VARIANT_STYLES = {
  info: "bg-info-inverse",
  success: "bg-success-inverse",
  error: "bg-error-inverse",
  danger: "bg-danger-inverse",
};
const VARIANT_ICONS = {
  info: "info",
  success: "checkCircle",
  error: "danger",
  danger: "danger",
};

export function Toast({ content, variant = ToastVariant.Info, dismissing = false, onClose }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const f = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(f);
  }, []);
  const visible = mounted && !dismissing;
  return html`
    <div class="overflow-hidden">
      <div
        class="rounded-[4px] max-w-[360px] w-full pointer-events-auto"
        style=${{
          transform: visible ? "translateY(0)" : "translateY(-100%)",
          transition: "transform 300ms ease-out",
        }}
      >
        <div
          class=${cn(
            "rounded-[4px] flex gap-2 items-start p-3 pr-12 label-small relative shadow-2xl overflow-hidden w-[360px]",
            VARIANT_STYLES[variant],
          )}
          style=${{ color: "var(--white)" }}
        >
          <${Icon}
            name=${VARIANT_ICONS[variant]}
            size=${20}
            className="flex-shrink-0 mt-[2px]"
            color="var(--white)"
          />
          <span class="label-small flex-grow min-w-0 break-words whitespace-pre-line">${content}</span>
          <${Button}
            variant=${ButtonVariant.Ghost}
            content=${ButtonContent.Icon}
            className="absolute top-1 right-1 btn-icon-rotate flex-shrink-0"
            onClick=${onClose}
          >
            <${Icon} name="close" color="var(--white)" />
          </${Button}>
        </div>
      </div>
    </div>
  `;
}

function ensureToastRoot() {
  let el = document.getElementById("toast-root");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast-root";
    el.className = "fixed top-3 right-3 z-[200] flex flex-col gap-2 pointer-events-none";
    document.body.appendChild(el);
  }
  return el;
}

// Imperative helper (a full provider/context arrives in Step 3).
export function showToast(content, variant = ToastVariant.Info, lifeMs = 4000) {
  const host = ensureToastRoot();
  const container = document.createElement("div");
  host.appendChild(container);
  const root = createRoot(container);

  let timer;
  const remove = () => {
    root.unmount();
    if (container.parentNode) container.parentNode.removeChild(container);
    clearTimeout(timer);
  };
  const render = (dismissing) =>
    root.render(html`<${Toast} content=${content} variant=${variant} dismissing=${dismissing} onClose=${dismiss} />`);
  function dismiss() {
    render(true);
    setTimeout(remove, 320);
  }
  render(false);
  timer = setTimeout(dismiss, lifeMs);
  return dismiss;
}
