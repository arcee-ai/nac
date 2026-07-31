// Minimal dev chrome: a live-reload status badge and transient toasts. Lives in a
// shadow root so the app's Tailwind build and global CSS cannot reach it, and vice
// versa. Theme custom properties still inherit across the shadow boundary, so
// semantic tokens keep working.

const STYLES = `
.layer {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.45;
}
.badge {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--color-bg-elevation-ground-inverse);
  color: var(--color-text-basic-primary-inverse);
  opacity: 0.5;
}
.badge:hover { opacity: 1; }
.dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-bg-success-inverse);
}
.dot[data-tone="warn"] { background: var(--color-bg-danger-inverse); }
.dot[data-tone="error"] { background: var(--color-bg-error-inverse); }
.toast {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: none;
  padding: 5px 10px;
  border-radius: 4px;
  background: var(--color-bg-elevation-ground-inverse);
  color: var(--color-text-basic-primary-inverse);
}
`;

const TOAST_MS = 1800;

export function createOverlay() {
  const host = document.createElement("div");
  host.dataset.nacDev = "overlay";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>${STYLES}</style>
    <div class="layer">
      <div class="toast"></div>
      <div class="badge"><span class="dot"></span><span class="text">dev</span></div>
    </div>
  `;
  document.body.appendChild(host);

  const toastNode = shadow.querySelector(".toast");
  const dot = shadow.querySelector(".dot");
  const badgeText = shadow.querySelector(".text");
  let toastTimer = 0;

  function setStatus(text, tone = "ok") {
    badgeText.textContent = text;
    dot.dataset.tone = tone;
  }

  function toast(message) {
    toastNode.textContent = message;
    toastNode.style.display = "block";
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastNode.style.display = "none";
    }, TOAST_MS);
  }

  return { setStatus, toast };
}
